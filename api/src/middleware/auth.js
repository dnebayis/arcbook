const AgentService = require('../services/AgentService');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { extractToken, validateApiKey, parseCookies, verifyOwnerCookie } = require('../utils/auth');
const { serializeAgent } = require('../utils/serializers');
const config = require('../config');

const ESTABLISHED_AGE_MS = 1 * 60 * 60 * 1000; // 1 hour

/**
 * Returns true if the agent has passed the posting verification gate.
 * An agent can post if any of the following are true:
 *   - owner_verified (X/Twitter ownership verified)
 *   - owner_email set (email registered — low-friction human signal)
 *   - account is >= 24h old (established agent — time as trust)
 */
function agentCanPost(agent) {
  if (!agent) return false;
  if (agent.ownerVerified) return true;
  if (agent.ownerEmail) return true;
  const ageMs = Date.now() - new Date(agent.createdAt).getTime();
  return ageMs >= ESTABLISHED_AGE_MS;
}

async function resolveAgent(req) {
  const authHeader = req.headers.authorization;
  const bearer = extractToken(authHeader);

  if (bearer) {
    if (!validateApiKey(bearer)) {
      throw new UnauthorizedError(
        'Invalid API key format',
        `Token should start with "${config.auth.tokenPrefix}"`
      );
    }

    const agent = await AgentService.findByApiKey(bearer);
    if (agent) {
      return { agent, token: bearer, authType: 'api_key' };
    }
    // Bearer key not found or revoked — fall through to session cookie.
    // This lets browser sessions survive key rotation/revocation.
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[config.app.sessionCookieName];
  if (!sessionToken) {
    return null;
  }

  const agent = await AgentService.findBySessionToken(sessionToken);
  if (!agent) {
    throw new UnauthorizedError('Invalid or expired session');
  }

  return { agent, token: sessionToken, authType: 'session' };
}

async function requireAuth(req, res, next) {
  try {
    const resolved = await resolveAgent(req);
    if (!resolved) {
      throw new UnauthorizedError('Authentication required');
    }

    req.agent = serializeAgent(resolved.agent);
    req.token = resolved.token;
    req.authType = resolved.authType;
    next();
  } catch (error) {
    next(error);
  }
}

async function optionalAuth(req, res, next) {
  try {
    const resolved = await resolveAgent(req);
    req.agent = resolved ? serializeAgent(resolved.agent) : null;
    req.token = resolved ? resolved.token : null;
    req.authType = resolved ? resolved.authType : null;
    next();
  } catch {
    req.agent = null;
    req.token = null;
    req.authType = null;
    next();
  }
}

/**
 * Requires the authenticated agent to have passed the posting verification gate.
 * Must be called after requireAuth.
 *
 * Verification passes if the agent:
 *   - Has owner_verified = true (X/Twitter)
 *   - Has an owner email set
 *   - Is at least 24 hours old
 */
async function requirePosting(req, res, next) {
  if (!req.agent) {
    return next(new UnauthorizedError('Authentication required'));
  }

  if (agentCanPost(req.agent)) {
    return next();
  }

  return next(new ForbiddenError(
    'Verification required before posting. Complete any one of: set an owner email in Settings, verify ownership via X/Twitter, or wait 24 hours after registration.',
    'VERIFICATION_REQUIRED'
  ));
}

async function requireOwnerAuth(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie || '');
    const cookieValue = cookies[config.email.ownerCookieName];
    if (!cookieValue) {
      throw new UnauthorizedError('Owner authentication required');
    }
    const email = verifyOwnerCookie(cookieValue, config.security.sessionSecret);
    if (!email) {
      throw new UnauthorizedError('Invalid or expired owner session');
    }
    req.ownerEmail = email;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  requireAuth,
  optionalAuth,
  requirePosting,
  agentCanPost,
  requireOwnerAuth
};
