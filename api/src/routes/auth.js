const crypto = require('crypto');
const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const AgentService = require('../services/AgentService');
const { buildSessionCookie, clearSessionCookie, buildOwnerCookie, parseCookies, hashToken } = require('../utils/auth');
const { success, noContent } = require('../utils/response');
const { serializeAgent } = require('../utils/serializers');
const { sendMagicLink } = require('../services/EmailService');
const { query, queryOne } = require('../config/database');
const config = require('../config');

const router = Router();

router.post('/session', authLimiter, asyncHandler(async (req, res) => {
  const { apiKey } = req.body;
  const { agent, sessionToken, expiresAt } = await AgentService.createSessionFromApiKey(apiKey, {
    userAgent: req.headers['user-agent'] || null,
    ipAddress: req.ip
  });

  res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, expiresAt));
  success(res, {
    agent: serializeAgent(agent),
    expiresAt
  });
}));

router.delete('/session', asyncHandler(async (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionToken = cookies[config.app.sessionCookieName];

  if (sessionToken) {
    await AgentService.destroySession(sessionToken);
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  noContent(res);
}));

router.get('/session', requireAuth, asyncHandler(async (req, res) => {
  success(res, { agent: req.agent });
}));

// --- Human Owner Magic Link Auth ---

router.post('/owner/magic-link', authLimiter, asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    // Always respond with the same message to avoid email enumeration
    return success(res, { message: 'If this email is registered, you\'ll receive a login link shortly.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const agent = await queryOne(
    `SELECT id FROM agents WHERE LOWER(owner_email) = $1 LIMIT 1`,
    [normalizedEmail]
  );

  if (agent) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + config.email.magicLinkTtlMinutes * 60 * 1000);

    await query(
      `INSERT INTO owner_magic_links (email, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [normalizedEmail, tokenHash, expiresAt]
    );

    const magicUrl = `${config.app.webBaseUrl}/auth/owner/verify?token=${rawToken}`;
    await sendMagicLink(normalizedEmail, magicUrl);
  }

  success(res, { message: 'If this email is registered, you\'ll receive a login link shortly.' });
}));

router.get('/owner/verify', asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=invalid_token`);
  }

  const tokenHash = hashToken(token);
  const link = await queryOne(
    `SELECT id, email, expires_at, used_at FROM owner_magic_links WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!link || link.used_at || new Date(link.expires_at) < new Date()) {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=expired_token`);
  }

  await query(`UPDATE owner_magic_links SET used_at = NOW() WHERE id = $1`, [link.id]);

  const ownerCookie = buildOwnerCookie(link.email, config.security.sessionSecret);
  res.setHeader('Set-Cookie', ownerCookie);
  res.redirect(`${config.app.webBaseUrl}/owner`);
}));

router.post('/owner/logout', asyncHandler(async (req, res) => {
  const { clearOwnerCookie } = require('../utils/auth');
  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

module.exports = router;
