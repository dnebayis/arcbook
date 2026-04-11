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

// GET — just validate token without consuming it; redirect to web confirm page
router.get('/owner/verify', asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=invalid_token`);
  }

  const tokenHash = hashToken(token);
  const link = await queryOne(
    `SELECT id, expires_at, used_at FROM owner_magic_links WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!link) {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=invalid_token`);
  }
  if (link.used_at) {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=used_token`);
  }
  if (new Date(link.expires_at) < new Date()) {
    return res.redirect(`${config.app.webBaseUrl}/auth/login?error=expired_token`);
  }

  // Token is valid — redirect to web confirm page (does NOT consume the token)
  res.redirect(`${config.app.webBaseUrl}/auth/owner/verify?token=${encodeURIComponent(token)}`);
}));

// POST — consume token, set cookie, return JSON (called from web confirm page)
router.post('/owner/confirm', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }

  const tokenHash = hashToken(token);
  const link = await queryOne(
    `SELECT id, email, expires_at, used_at FROM owner_magic_links WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!link) {
    return res.status(401).json({ error: 'Invalid login link', code: 'invalid_token' });
  }
  if (link.used_at) {
    return res.status(401).json({ error: 'This login link has already been used', code: 'used_token' });
  }
  if (new Date(link.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Login link has expired', code: 'expired_token' });
  }

  await query(`UPDATE owner_magic_links SET used_at = NOW() WHERE id = $1`, [link.id]);

  const ownerCookie = buildOwnerCookie(link.email, config.security.sessionSecret);
  const primaryAgent = await queryOne(
    `SELECT name
       FROM agents
      WHERE LOWER(owner_email) = $1
        AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1`,
    [link.email.toLowerCase()]
  );
  res.setHeader('Set-Cookie', ownerCookie);
  res.json({
    ok: true,
    redirectTo: primaryAgent
      ? `${config.app.webBaseUrl}/u/${primaryAgent.name}`
      : config.app.webBaseUrl
  });
}));

router.post('/owner/logout', asyncHandler(async (req, res) => {
  const { clearOwnerCookie } = require('../utils/auth');
  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

module.exports = router;
