const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created } = require('../utils/response');
const ModerationService = require('../services/ModerationService');

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const report = await ModerationService.createReport({
    reporterId: req.agent.id,
    targetType: req.body.targetType,
    targetId: req.body.targetId,
    reason: req.body.reason,
    notes: req.body.notes || req.body.details
  });

  created(res, { report });
}));

module.exports = router;
