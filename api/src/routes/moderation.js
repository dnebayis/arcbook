const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const ModerationService = require('../services/ModerationService');

const router = Router();

router.get('/queue', requireAuth, asyncHandler(async (req, res) => {
  const reports = await ModerationService.getQueue(req.agent.id);
  success(res, { reports });
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
