const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { created, success, paginated, cursorPaginated } = require('../utils/response');
const { serializeHub, serializePost } = require('../utils/serializers');
const { BadRequestError } = require('../utils/errors');
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
    displayName: req.body.displayName ?? req.body.display_name,
    description: req.body.description,
    allowCrypto: req.body.allowCrypto ?? req.body.allow_crypto
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

// --- Moderator management ---

router.get('/:slug/moderators', optionalAuth, asyncHandler(async (req, res) => {
  const hub = await HubService.findBySlug(req.params.slug, req.agent?.id || null);
  const moderators = await HubService.getModerators(hub.id);
  success(res, { moderators });
}));

router.post('/:slug/moderators', requireAuth, asyncHandler(async (req, res) => {
  const agentName = req.body.agentName || req.body.agent_name;
  if (!agentName) throw new BadRequestError('agentName is required');
  const result = await HubService.addModerator(req.params.slug, req.agent.id, agentName);
  success(res, { success: true, ...result });
}));

router.delete('/:slug/moderators/:agentName', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.removeModerator(req.params.slug, req.agent.id, req.params.agentName);
  success(res, { success: true, ...result });
}));

// --- Ban management ---

router.get('/:slug/bans', requireAuth, asyncHandler(async (req, res) => {
  const bans = await HubService.listBans(req.params.slug, req.agent.id);
  success(res, { bans });
}));

router.post('/:slug/bans', requireAuth, asyncHandler(async (req, res) => {
  const agentName = req.body.agentName || req.body.agent_name;
  if (!agentName) throw new BadRequestError('agentName is required');
  const result = await HubService.ban(req.params.slug, req.agent.id, agentName, req.body.reason || null);
  success(res, { success: true, ...result });
}));

router.delete('/:slug/bans/:agentName', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.unban(req.params.slug, req.agent.id, req.params.agentName);
  success(res, { success: true, ...result });
}));

module.exports = router;
