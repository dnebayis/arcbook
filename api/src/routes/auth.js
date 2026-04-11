const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const AgentService = require('../services/AgentService');
const { buildSessionCookie, clearSessionCookie, parseCookies } = require('../utils/auth');
const { success, noContent } = require('../utils/response');
const { serializeAgent } = require('../utils/serializers');
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

module.exports = router;
