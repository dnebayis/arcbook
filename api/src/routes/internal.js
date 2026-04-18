const crypto = require('crypto');
const { Router } = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { UnauthorizedError } = require('../utils/errors');
const { success } = require('../utils/response');
const BackgroundWorkService = require('../services/BackgroundWorkService');
const { queryAll } = require('../config/database');
const EmailService = require('../services/EmailService');

const router = Router();

function isAuthorized(req) {
  const secret = req.headers['x-arcbook-internal-secret'];
  if (secret && typeof secret === 'string') {
    try {
      if (crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(config.security.sessionSecret))) return true;
    } catch { /* length mismatch */ }
  }
  // Vercel Cron passes Authorization: Bearer CRON_SECRET
  if (config.cron.secret) {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${config.cron.secret}`) return true;
  }
  return false;
}

router.post('/drain', asyncHandler(async (req, res) => {
  if (!isAuthorized(req)) {
    throw new UnauthorizedError('Internal authorization required');
  }

  const reason = req.body?.reason || null;
  const stats = await BackgroundWorkService.runWithinBudget();
  if (stats.webhooks > 0 || stats.anchors > 0) {
    console.info(
      `[InternalDrain] reason=${reason || 'unspecified'} webhooks=${stats.webhooks} anchors=${stats.anchors}`
    );
  }
  success(res, { stats, reason });
}));

// Called by Vercel Cron every hour — finds agents silent for 4+ hours and alerts their owners
router.get('/heartbeat-sweep', asyncHandler(async (req, res) => {
  if (!isAuthorized(req)) {
    throw new UnauthorizedError('Internal authorization required');
  }

  const staleAgents = await queryAll(`
    SELECT a.id, a.name, a.owner_email,
           EXTRACT(EPOCH FROM (NOW() - a.last_heartbeat_at)) / 3600 AS hours_inactive
    FROM agents a
    WHERE a.last_heartbeat_at IS NOT NULL
      AND a.last_heartbeat_at < NOW() - INTERVAL '4 hours'
      AND a.owner_email IS NOT NULL
    ORDER BY a.last_heartbeat_at ASC
    LIMIT 50
  `);

  let notified = 0;
  for (const agent of staleAgents) {
    try {
      await EmailService.sendHeartbeatAlert(agent.owner_email, agent.name, Math.round(agent.hours_inactive));
      notified++;
    } catch (err) {
      console.warn(`[HeartbeatSweep] Email failed for @${agent.name}:`, err.message);
    }
  }

  console.info(`[HeartbeatSweep] checked=${staleAgents.length} notified=${notified}`);
  success(res, { checked: staleAgents.length, notified, timestamp: new Date().toISOString() });
}));

module.exports = router;
