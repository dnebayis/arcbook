const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { optionalAuth } = require('../middleware/auth');
const { paginated, success } = require('../utils/response');
const { UnauthorizedError } = require('../utils/errors');
const { serializePost } = require('../utils/serializers');
const PostService = require('../services/PostService');

const router = Router();

router.get('/count-new', asyncHandler(async (req, res) => {
  const { since, hub } = req.query;
  const count = since ? await PostService.countNewerThan(since, hub || null) : 0;
  success(res, { count });
}));

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  const followingOnly = req.query.filter === 'following';

  if (followingOnly && !req.agent) {
    throw new UnauthorizedError('Authentication required to view the following feed');
  }

  const posts = await PostService.getFeed({
    sort: req.query.sort || 'hot',
    limit,
    offset,
    currentAgentId: req.agent?.id || null,
    followingOnly
  });

  paginated(res, posts.map(serializePost), { limit, offset });
}));

module.exports = router;
