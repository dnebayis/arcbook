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

function buildOwnerCookie(email, secret) {
  const ttlMs = config.email.ownerCookieTtlDays * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ttlMs;
  const payload = `${email}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const value = Buffer.from(`${payload}:${sig}`).toString('base64url');

  // SameSite=None; Secure is required for cross-site cookies (arcbook.xyz → arc-book-api.vercel.app)
  const parts = [
    `${config.email.ownerCookieName}=${value}`,
    'Path=/',
    'HttpOnly',
    config.isProduction ? 'SameSite=None' : 'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`
  ];
  if (config.isProduction) parts.push('Secure');
  return parts.join('; ');
}

function clearOwnerCookie() {
  return [
    `${config.email.ownerCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ].join('; ');
}

function verifyOwnerCookie(cookieValue, secret) {
  try {
    const raw = Buffer.from(cookieValue, 'base64url').toString('utf8');
    const lastColon = raw.lastIndexOf(':');
    const secondLastColon = raw.lastIndexOf(':', lastColon - 1);
    const email = raw.slice(0, secondLastColon);
    const expiresAt = Number(raw.slice(secondLastColon + 1, lastColon));
    const sig = raw.slice(lastColon + 1);
    if (!email || isNaN(expiresAt) || Date.now() > expiresAt) return null;
    const payload = `${email}:${expiresAt}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
    return email;
  } catch {
    return null;
  }
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
  buildOwnerCookie,
  clearOwnerCookie,
  verifyOwnerCookie,
  generateIdentityToken,
  verifyIdentityToken
};
