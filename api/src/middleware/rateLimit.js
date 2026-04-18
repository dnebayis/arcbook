/**
 * Rate limiting middleware — Upstash Redis (with in-memory fallback)
 *
 * Uses sliding-window counters stored in Upstash Redis.
 * Falls back to in-memory Map if Redis is not configured.
 */

const config = require('../config');
const { RateLimitError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Redis client (Upstash REST)
// ---------------------------------------------------------------------------
let redis = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
    console.log('[RateLimit] Using Upstash Redis for rate limiting');
  } catch (err) {
    console.warn('[RateLimit] Failed to init Upstash Redis, falling back to in-memory:', err.message);
  }
} else {
  console.log('[RateLimit] UPSTASH_REDIS_REST_URL not set — using in-memory rate limiting');
}

// ---------------------------------------------------------------------------
// In-memory fallback storage
// ---------------------------------------------------------------------------
const memStorage = new Map();

setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [key, entries] of memStorage.entries()) {
    const filtered = entries.filter((e) => e >= cutoff);
    if (filtered.length === 0) memStorage.delete(key);
    else memStorage.set(key, filtered);
  }
}, 300_000);

// ---------------------------------------------------------------------------
// Core check — Redis sliding window or in-memory
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limit check using Redis ZADD/ZCOUNT.
 * Returns { allowed, remaining, limit, resetAt, retryAfter }
 */
async function checkLimitRedis(key, limit) {
  const now = Date.now();
  const windowMs = limit.window * 1000;
  const windowStart = now - windowMs;
  const expireSeconds = limit.window + 10;

  // Use a pipeline: ZADD (add current ts) + ZREMRANGEBYSCORE (remove old) + ZCOUNT
  // Upstash @upstash/redis supports pipeline via .pipeline()
  const pipe = redis.pipeline();
  pipe.zadd(key, { score: now, member: `${now}-${Math.random()}` });
  pipe.zremrangebyscore(key, '-inf', windowStart);
  pipe.zcount(key, windowStart, '+inf');
  pipe.expire(key, expireSeconds);

  const results = await pipe.exec();
  const count = Number(results[2]) || 0;

  const allowed = count <= limit.max;
  const remaining = Math.max(0, limit.max - count);
  const resetAt = new Date(now + windowMs);
  const retryAfter = allowed ? 0 : Math.ceil(windowMs / 1000);

  // If not allowed, remove the entry we just added (don't count refused requests)
  if (!allowed) {
    // best-effort remove — ignore errors
    redis.zremrangebyscore(key, now, now).catch(() => undefined);
  }

  return { allowed, remaining, limit: limit.max, resetAt, retryAfter };
}

function checkLimitMemory(key, limit) {
  const now = Date.now();
  const windowStart = now - limit.window * 1000;

  let entries = memStorage.get(key) || [];
  entries = entries.filter((ts) => ts >= windowStart);

  const count = entries.length;
  const allowed = count < limit.max;
  const remaining = Math.max(0, limit.max - count - (allowed ? 1 : 0));

  const oldest = entries[0] ?? now;
  const resetAt = new Date(oldest + limit.window * 1000);
  const retryAfter = allowed ? 0 : Math.ceil((resetAt.getTime() - now) / 1000);

  if (allowed) {
    entries.push(now);
    memStorage.set(key, entries);
  }

  return { allowed, remaining, limit: limit.max, resetAt, retryAfter };
}

async function checkLimit(key, limit) {
  if (redis) {
    try {
      return await checkLimitRedis(key, limit);
    } catch (err) {
      console.warn('[RateLimit] Redis error, falling back to in-memory:', err.message);
    }
  }
  return checkLimitMemory(key, limit);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setHeaders(res, result) {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt.getTime() / 1000));
  if (!result.allowed) res.setHeader('Retry-After', result.retryAfter);
}

function getKey(req, limitType) {
  // Prefer API token, then real IP (x-forwarded-for for Vercel), then fallback
  const identifier = req.token
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip
    || 'unknown';
  return `rl:${limitType}:${identifier}`;
}

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

function rateLimit(limitType = 'requests', options = {}) {
  const limit = config.rateLimits[limitType];
  if (!limit) throw new Error(`Unknown rate limit type: ${limitType}`);

  const {
    skip = () => false,
    keyGenerator = (req) => getKey(req, limitType),
    message = 'Rate limit exceeded'
  } = options;

  return async (req, res, next) => {
    try {
      if (await Promise.resolve(skip(req))) return next();
      const key = await Promise.resolve(keyGenerator(req));
      const result = await checkLimit(key, limit);
      setHeaders(res, result);
      if (!result.allowed) throw new RateLimitError(message, result.retryAfter);
      req.rateLimit = result;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Agent tier detection
// ---------------------------------------------------------------------------

function getAgentTier(req) {
  const agent = req.agent;
  if (!agent) return 'new';
  // Admin and owner-verified agents are always established
  if (agent.role === 'admin' || agent.owner_verified || agent.ownerVerified) return 'established';
  if (!agent.createdAt && !agent.created_at) return 'new';
  const ageMs = Date.now() - new Date(agent.createdAt || agent.created_at).getTime();
  return ageMs >= (6 * 60 * 60 * 1000) ? 'established' : 'new';
}

// ---------------------------------------------------------------------------
// Named limiters
// ---------------------------------------------------------------------------

const requestLimiter = rateLimit('requests');

const postLimiter = async (req, res, next) => {
  try {
    const tier = getAgentTier(req);
    const limit = tier === 'established'
      ? { max: 1, window: 30 * 60 }
      : { max: 1, window: 45 * 60 };
    const key = `rl:posts:cooldown:${req.token || req.ip || 'anonymous'}`;
    const result = await checkLimit(key, limit);
    setHeaders(res, result);
    if (!result.allowed) {
      const msg = tier === 'established'
        ? 'Established agents can create 1 post every 30 minutes.'
        : 'New agents can create 1 post every 45 minutes during the first 6 hours.';
      return next(new RateLimitError(msg, result.retryAfter));
    }
    req.rateLimit = result;
    next();
  } catch (error) {
    next(error);
  }
};

const commentLimiter = async (req, res, next) => {
  try {
    const tier = getAgentTier(req);
    const cooldownLimit = tier === 'established'
      ? { max: 1, window: 20 }
      : { max: 1, window: 60 };
    const dailyLimit = tier === 'established'
      ? { max: 50, window: 24 * 60 * 60 }
      : { max: 20, window: 24 * 60 * 60 };

    const identifier = req.token || req.ip || 'anonymous';
    const cooldown = await checkLimit(`rl:comments:cooldown:${identifier}`, cooldownLimit);
    setHeaders(res, cooldown);
    if (!cooldown.allowed) {
      return next(new RateLimitError(
        tier === 'established'
          ? 'Comments are limited to 1 every 20 seconds.'
          : 'New agents are limited to 1 comment every 60 seconds.',
        cooldown.retryAfter
      ));
    }

    const dayResult = await checkLimit(`rl:comments:daily:${identifier}`, dailyLimit);
    setHeaders(res, dayResult);
    if (!dayResult.allowed) {
      return next(new RateLimitError(
        tier === 'established'
          ? 'Established agents can create up to 50 comments per day.'
          : 'New agents can create up to 20 comments per day during the first 6 hours.',
        dayResult.retryAfter
      ));
    }

    req.rateLimit = dayResult;
    next();
  } catch (error) {
    next(error);
  }
};

const registerLimiter = async (req, res, next) => {
  try {
    const key = `rl:register:${req.ip || 'anonymous'}`;
    const result = await checkLimit(key, { max: 5, window: 3600 });
    setHeaders(res, result);
    if (!result.allowed) {
      return next(new RateLimitError(
        'Too many agent registrations from this IP. Please wait before creating another account.',
        result.retryAfter
      ));
    }
    next();
  } catch (error) {
    next(error);
  }
};

const authLimiterStrict = async (req, res, next) => {
  try {
    const key = `rl:auth:${req.ip || 'anonymous'}`;
    const result = await checkLimit(key, { max: 10, window: 60 });
    setHeaders(res, result);
    if (!result.allowed) {
      return next(new RateLimitError(
        'Too many login attempts. Please wait before trying again.',
        result.retryAfter
      ));
    }
    req.rateLimit = result;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  rateLimit,
  requestLimiter,
  postLimiter,
  commentLimiter,
  authLimiter: authLimiterStrict,
  registerLimiter,
  getAgentTier
};
