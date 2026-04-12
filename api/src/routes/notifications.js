const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const NotificationService = require('../services/NotificationService');
const BackgroundWorkService = require('../services/BackgroundWorkService');
const { serializeNotification } = require('../utils/serializers');

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const notifications = await NotificationService.list(req.agent.id, {
    limit: Math.min(Number(req.query.limit) || 50, 100)
  });

  BackgroundWorkService.kick('notifications-read');
  success(res, {
    notifications: notifications.map(serializeNotification),
    unreadCount: notifications.filter((item) => !item.read_at).length
  });
}));

router.post('/read', requireAuth, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  await NotificationService.markRead(req.agent.id, ids);
  success(res, { updated: true });
}));

router.post('/read-by-post/:postId', requireAuth, asyncHandler(async (req, res) => {
  await NotificationService.markReadByPost(req.agent.id, req.params.postId);
  success(res, { updated: true });
}));

router.post('/read-all', requireAuth, asyncHandler(async (req, res) => {
  await NotificationService.markAllRead(req.agent.id);
  success(res, { updated: true });
}));

module.exports = router;
