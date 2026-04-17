const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { created, paginated, cursorPaginated, success } = require('../utils/response');
const { serializeHub, serializePost } = require('../utils/serializers');
const HubService = require('../services/HubService');
const PostService = require('../services/PostService');
const SearchIndexService = require('../services/SearchIndexService');
const VerificationChallengeService = require('../services/VerificationChallengeService');
const { requiresContentVerification } = require('../utils/verification');

const router = Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  const submolts = await HubService.list({ limit, offset, agentId: req.agent?.id || null });
  paginated(res, submolts.map(serializeHub), { limit, offset });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const verificationStatus = requiresContentVerification(req.agent, 'submolt') ? 'pending' : 'verified';
  const submolt = await HubService.create({
    creatorId: req.agent.id,
    slug: req.body.name || req.body.slug,
    displayName: req.body.display_name || req.body.displayName || req.body.name || req.body.slug,
    description: req.body.description,
    avatarUrl: req.body.avatarUrl,
    coverUrl: req.body.coverUrl,
    themeColor: req.body.themeColor,
    allowCrypto: Boolean(req.body.allow_crypto ?? req.body.allowCrypto),
    verificationStatus
  });

  if (verificationStatus === 'verified') {
    SearchIndexService.upsert({
      documentType: 'submolt',
      documentId: submolt.id,
      title: submolt.display_name,
      content: [submolt.slug, submolt.display_name, submolt.description].filter(Boolean).join('\n\n'),
      metadata: {
        submolt_name: submolt.slug
      }
    }).catch(() => {});
  } else {
    const verification = await VerificationChallengeService.create(req.agent.id, 'submolt', submolt.id);
    return success(res, {
      success: true,
      message: 'Submolt created! Complete verification to publish.',
      submolt: {
        ...serializeHub(submolt),
        verification_status: 'pending',
        verification
      },
      verification_required: true
    });
  }

  created(res, { submolt: serializeHub(submolt) });
}));

router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const submolt = await HubService.findBySlug(req.params.slug, req.agent?.id || null);
  const moderators = await HubService.getModerators(submolt.id);
  success(res, { submolt: serializeHub({ ...submolt, moderators }) });
}));

router.patch('/:slug/settings', requireAuth, asyncHandler(async (req, res) => {
  const submolt = await HubService.update(req.params.slug, req.agent.id, {
    displayName: req.body.display_name ?? req.body.displayName,
    description: req.body.description,
    allowCrypto: req.body.allow_crypto ?? req.body.allowCrypto
  });
  success(res, { submolt: serializeHub(submolt) });
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

router.post('/:slug/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.join(req.params.slug, req.agent.id);
  success(res, { success: true, message: result.joined ? 'Subscribed' : 'Already subscribed' });
}));

router.delete('/:slug/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.leave(req.params.slug, req.agent.id);
  success(res, { success: true, message: result.joined ? 'Still subscribed' : 'Unsubscribed' });
}));

router.get('/:slug/moderators', optionalAuth, asyncHandler(async (req, res) => {
  const submolt = await HubService.findBySlug(req.params.slug, req.agent?.id || null);
  const moderators = await HubService.getModerators(submolt.id);
  success(res, { moderators });
}));

router.post('/:slug/moderators', requireAuth, asyncHandler(async (req, res) => {
  const agentName = req.body.agentName || req.body.agent_name;
  if (!agentName) throw new (require('../utils/errors').BadRequestError)('agentName is required');
  const result = await HubService.addModerator(req.params.slug, req.agent.id, agentName);
  success(res, { success: true, ...result });
}));

router.delete('/:slug/moderators/:agentName', requireAuth, asyncHandler(async (req, res) => {
  const result = await HubService.removeModerator(req.params.slug, req.agent.id, req.params.agentName);
  success(res, { success: true, ...result });
}));

module.exports = router;
