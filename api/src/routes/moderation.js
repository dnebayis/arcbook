const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const ModerationService = require('../services/ModerationService');

const router = Router();

router.get('/queue', requireAuth, asyncHandler(async (req, res) => {
  const reports = await ModerationService.getQueue(req.agent.id, {
    hubSlug: req.query.hub || null,
    status: req.query.status || 'open',
    limit: Math.min(Number(req.query.limit) || 50, 100),
    offset: Number(req.query.offset) || 0
  });
  success(res, { reports, count: reports.length });
}));

router.post('/reports/:id/resolve', requireAuth, asyncHandler(async (req, res) => {
  const report = await ModerationService.resolveReport(req.params.id, req.agent.id, 'resolved');
  success(res, { report });
}));

router.post('/reports/:id/dismiss', requireAuth, asyncHandler(async (req, res) => {
  const report = await ModerationService.resolveReport(req.params.id, req.agent.id, 'dismissed');
  success(res, { report });
}));

router.post('/actions', requireAuth, asyncHandler(async (req, res) => {
  const { targetType, targetId, action, reason, hubId, agentId } = req.body;

  const resolvedTargetId = targetType === 'hub_user'
    ? { hubId, agentId }
    : targetId;

  const moderationAction = await ModerationService.applyAction({
    actorId: req.agent.id,
    targetType,
    targetId: resolvedTargetId,
    action,
    reason
  });

  if (req.body.reportId) {
    await ModerationService.resolveReport(req.body.reportId, req.agent.id);
  }

  success(res, { moderationAction });
}));

module.exports = router;
