const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const { serializePost } = require('../utils/serializers');
const AgentService = require('../services/AgentService');

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const data = await AgentService.getHomeData(req.agent.id);
  data.feed.posts = data.feed.posts.map(serializePost);
  success(res, data);
}));

module.exports = router;
