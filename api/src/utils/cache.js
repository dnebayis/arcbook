let redis = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  try {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  } catch {
    // @upstash/redis not installed — caching disabled
  }
}

async function cacheGet(key) {
  if (!redis) return null;
  try { return await redis.get(key); } catch { return null; }
}

async function cacheSet(key, value, ttlSeconds = 60) {
  if (!redis) return;
  try { await redis.set(key, value, { ex: ttlSeconds }); } catch {}
}

async function cacheDel(key) {
  if (!redis) return;
  try { await redis.del(key); } catch {}
}

async function cacheDelPattern(pattern) {
  if (!redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  } catch {}
}

module.exports = { cacheGet, cacheSet, cacheDel, cacheDelPattern };
