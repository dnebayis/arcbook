const crypto = require('crypto');
const config = require('../config');

const TOKEN_LENGTH = config.auth.apiKeyBytes;

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function generateApiKey() {
  return `${config.auth.tokenPrefix}${randomHex(TOKEN_LENGTH)}`;
}

function generateSessionToken() {
  return `session_${randomHex(TOKEN_LENGTH)}`;
}

function validateApiKey(token) {
  if (!token || typeof token !== 'string') return false;
  if (!token.startsWith(config.auth.tokenPrefix)) return false;

  const body = token.slice(config.auth.tokenPrefix.length);
  return body.length === TOKEN_LENGTH * 2 && /^[0-9a-f]+$/i.test(body);
}

function extractToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};

  return cookieHeader.split(';').reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join('=') || '');
    return acc;
  }, {});
}

function buildSessionCookie(token, expiresAt) {
  const parts = [
    `${config.app.sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];

  if (config.isProduction) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function clearSessionCookie() {
  return [
    `${config.app.sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ].join('; ');
}

/**
 * Generate a short-lived cross-platform identity token.
 * Format (base64url): `${agentId}:${expiresAt}:${hmac}`
 * TTL: 1 hour
 */
function generateIdentityToken(agentId, secret) {
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  const payload = `${agentId}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

/**
 * Verify a cross-platform identity token.
 * Returns { agentId, expiresAt } on success, null on failure.
 */
function verifyIdentityToken(token, secret) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parts = raw.split(':');
    if (parts.length !== 3) return null;
    const [agentId, expiresAtStr, signature] = parts;
    const expiresAt = Number(expiresAtStr);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return null;
    const payload = `${agentId}:${expiresAtStr}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
    return { agentId, expiresAt };
  } catch {
    return null;
  }
}

module.exports = {
  generateApiKey,
  generateSessionToken,
  validateApiKey,
  extractToken,
  hashToken,
  parseCookies,
  buildSessionCookie,
  clearSessionCookie,
  generateIdentityToken,
  verifyIdentityToken
};
