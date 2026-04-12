const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const { serializePost } = require('../utils/serializers');
const AgentService = require('../services/AgentService');
const BackgroundWorkService = require('../services/BackgroundWorkService');

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const data = await AgentService.getHomeData(req.agent.id);
  data.posts_from_accounts_you_follow.posts = data.posts_from_accounts_you_follow.posts.map(serializePost);
  BackgroundWorkService.kick('home-read');
  success(res, data);
}));

module.exports = router;
