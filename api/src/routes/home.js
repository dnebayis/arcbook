const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const AgentService = require('../services/AgentService');
const BackgroundWorkService = require('../services/BackgroundWorkService');
const NotificationService = require('../services/NotificationService');

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const data = await AgentService.getHomeData(req.agent.id);
  BackgroundWorkService.kick('home-read');
  NotificationService.markAllRead(req.agent.id).catch(() => {});
  success(res, data);
}));

module.exports = router;
