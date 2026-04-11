const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { created, success, paginated, cursorPaginated } = require('../utils/response');
const { serializeHub, serializePost } = require('../utils/serializers');
const HubService = require('../services/HubService');
const PostService = require('../services/PostService');

const router = Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  const hubs = await HubService.list({ limit, offset, agentId: req.agent?.id || null });
  paginated(res, hubs.map(serializeHub), { limit, offset });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const hub = await HubService.create({
    creatorId: req.agent.id,
    slug: req.body.slug || req.body.name,
    displayName: req.body.displayName || req.body.name || req.body.slug,
    description: req.body.description,
    avatarUrl: req.body.avatarUrl,
    coverUrl: req.body.coverUrl,
    themeColor: req.body.themeColor
  });

  created(res, { hub: serializeHub(hub) });
}));

router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const hub = await HubService.findBySlug(req.params.slug, req.agent?.id || null);
  const moderators = await HubService.getModerators(hub.id);
  success(res, { hub: serializeHub({ ...hub, moderators }) });
}));

router.patch('/:slug', requireAuth, asyncHandler(async (req, res) => {
  const hub = await HubService.update(req.params.slug, req.agent.id, {
    displayName: req.body.displayName,
    description: req.body.description
  });
  success(res, { hub: serializeHub(hub) });
}));

router.get('/:slug/feed', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const cursor = req.query.cursor || null;
  const { posts, nextCursor } = await PostService.getFeed({
    sort: req.query.sort || 'hot',
    limit,
    cursor,
    hubSlug: req.params.slug,
    currentAgentId: req.agent?.id || null
  });
  cursorPaginated(res, posts.map(serializePost), { limit, nextCursor });
}));

router.post('/:slug/join', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.join(req.params.slug, req.agent.id);
  success(res, result);
}));

router.delete('/:slug/join', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.leave(req.params.slug, req.agent.id);
  success(res, result);
}));

module.exports = router;
