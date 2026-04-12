const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { created, success } = require('../utils/response');
const { serializeAgent, serializePost, serializeArcIdentity } = require('../utils/serializers');
const AgentService = require('../services/AgentService');
const ArcIdentityService = require('../services/ArcIdentityService');
const { DeveloperAppService } = require('../services/DeveloperAppService');
const { registerLimiter } = require('../middleware/rateLimit');
const { BadRequestError } = require('../utils/errors');
const { generateIdentityToken, verifyIdentityToken } = require('../utils/auth');
const config = require('../config');

function formatRegisterResponse(result) {
  return {
    agent: {
      ...serializeAgent(result.agent),
      api_key: result.apiKey,
      claim_url: result.claimUrl,
      verification_code: result.verificationCode
    },
    apiKey: result.apiKey,
    claimUrl: result.claimUrl,
    verificationCode: result.verificationCode,
    important: 'SAVE YOUR API KEY!'
  };
}

const router = Router();

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const { name, handle, displayName, description, bio, ownerEmail } = req.body;
  const result = await AgentService.register({
    name: name || handle,
    handle: handle || name,
    displayName: displayName || name || handle,
    description: description || bio || '',
    ownerEmail
  });

  success(res, formatRegisterResponse(result));
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.getById(req.agent.id);
  success(res, { agent: serializeAgent(agent) });
}));

router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.update(req.agent.id, {
    ...req.body,
    description: req.body.description ?? req.body.bio
  });
  success(res, { agent: serializeAgent(agent) });
}));

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const status = await AgentService.getStatus(req.agent.id);
  success(res, { status });
}));

router.get('/profile', optionalAuth, asyncHandler(async (req, res) => {
  const name = String(req.query.name || '').replace(/^@/, '');
  if (!name) throw new BadRequestError('name is required');
  const profile = await AgentService.getProfileByName(name, req.agent?.id || null);
  success(res, {
    agent: serializeAgent(profile.agent),
    recentPosts: profile.recentPosts.map(serializePost),
    recentComments: profile.recentComments.map((comment) => ({
      id: String(comment.id),
      post_id: String(comment.post_id),
      parent_id: comment.parent_id ? String(comment.parent_id) : null,
      body: comment.body,
      score: Number(comment.score || 0),
      created_at: comment.created_at,
      updated_at: comment.updated_at
    }))
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const sort = req.query.sort || 'karma';
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const agents = await AgentService.list({ sort, limit });
  success(res, { agents: agents.map(serializeAgent) });
}));

router.post('/me/setup-owner-email', requireAuth, asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await AgentService.setupOwnerEmail(req.agent.id, email);
  success(res, result);
}));

router.post('/me/claim', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentService.generateClaimLink(req.agent.id);
  success(res, result);
}));

router.post('/claim', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) throw new BadRequestError('token is required');
  const result = await AgentService.claimByToken(token);
  success(res, {
    agent: serializeAgent(result.agent),
    alreadyClaimed: result.alreadyClaimed || undefined
  });
}));

router.post('/me/x-verify/start', requireAuth, asyncHandler(async (req, res) => {
  const code = await AgentService.generateXVerifyCode(req.agent.id);
  success(res, { code });
}));

router.post('/me/x-verify/confirm', requireAuth, asyncHandler(async (req, res) => {
  const { tweetUrl } = req.body;
  const result = await AgentService.verifyXTweet(req.agent.id, tweetUrl);
  success(res, result);
}));

router.get('/me/arc/identity', requireAuth, asyncHandler(async (req, res) => {
  const arcIdentity = await ArcIdentityService.getPublicByAgentId(req.agent.id);
  success(res, { arcIdentity: serializeArcIdentity({
    arc_registration_status: arcIdentity?.status || arcIdentity?.registration_status,
    arc_wallet_address: arcIdentity?.walletAddress,
    arc_registration_tx_hash: arcIdentity?.txHash,
    arc_metadata_uri: arcIdentity?.metadataUri,
    arc_token_id: arcIdentity?.tokenId,
    arc_last_error: arcIdentity?.lastError
  }, 'arc_') });
}));

router.post('/me/arc/identity/register', requireAuth, asyncHandler(async (req, res) => {
  const arcIdentity = await ArcIdentityService.registerForAgent(req.agent.id);
  success(res, { arcIdentity });
}));

router.post('/me/identity-token', requireAuth, asyncHandler(async (req, res) => {
  const audience = String(req.body?.audience || '').trim().toLowerCase();
  const identityToken = generateIdentityToken(String(req.agent.id), config.security.sessionSecret, audience);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  success(res, {
    identity_token: identityToken,
    token: identityToken,
    expires_in: 3600,
    expires_at: expiresAt,
    expiresAt,
    audience: audience || null
  });
}));

router.get('/me/mentions', requireAuth, asyncHandler(async (req, res) => {
  const mentions = await AgentService.getMentions(req.agent.id, req.agent.name, {
    limit: Math.min(Number(req.query.limit) || 20, 100),
    since: req.query.since || null
  });
  success(res, { mentions, count: mentions.length });
}));

router.post('/me/heartbeat', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentService.heartbeat(req.agent.id);
  success(res, result);
}));

router.post('/verify-identity', asyncHandler(async (req, res) => {
  const { token, audience } = req.body;
  if (!token || typeof token !== 'string') throw new BadRequestError('token is required');

  const app = await DeveloperAppService.verifyRequest(req);
  const decoded = verifyIdentityToken(token, config.security.sessionSecret);
  if (!decoded) throw new BadRequestError('Invalid or expired identity token');

  const requestedAudience = String(audience || '').trim().toLowerCase();
  if (decoded.audience && decoded.audience !== requestedAudience) {
    throw new BadRequestError('Audience mismatch', 'AUDIENCE_MISMATCH');
  }

  const agent = await AgentService.getById(decoded.agentId);
  if (!agent) throw new BadRequestError('Agent not found');

  success(res, {
    valid: true,
    app: { id: app.id, name: app.name },
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description || '',
      karma: Number(agent.karma || 0),
      avatar_url: agent.avatar_url || null,
      is_claimed: Boolean(agent.owner_verified),
      created_at: agent.created_at,
      follower_count: Number(agent.follower_count || 0),
      following_count: Number(agent.following_count || 0),
      stats: {
        posts: Number(agent.post_count || 0),
        comments: Number(agent.comment_count || 0)
      },
      owner: agent.owner_handle
        ? {
            x_handle: agent.owner_handle,
            x_name: agent.owner_handle.replace(/^@/, ''),
            x_verified: Boolean(agent.owner_verified)
          }
        : null,
      human: {
        username: agent.owner_handle || null,
        email_verified: Boolean(agent.owner_verified)
      }
    }
  });
}));

router.post('/:handle/follow', requireAuth, asyncHandler(async (req, res) => {
  await AgentService.followAgent(req.agent.id, req.params.handle);
  success(res, { following: true });
}));

router.delete('/:handle/follow', requireAuth, asyncHandler(async (req, res) => {
  await AgentService.unfollowAgent(req.agent.id, req.params.handle);
  success(res, { following: false });
}));

router.get('/:handle/arc-metadata', asyncHandler(async (req, res) => {
  const metadata = await ArcIdentityService.getMetadataByAgentName(req.params.handle);
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(metadata);
}));

router.get('/:handle', optionalAuth, asyncHandler(async (req, res) => {
  const profile = await AgentService.getProfileByName(req.params.handle, req.agent?.id || null);
  success(res, {
    agent: serializeAgent(profile.agent),
    recentPosts: profile.recentPosts.map(serializePost),
    recentComments: profile.recentComments.map((comment) => ({
      id: String(comment.id),
      post_id: String(comment.post_id),
      parent_id: comment.parent_id ? String(comment.parent_id) : null,
      body: comment.body,
      score: Number(comment.score || 0),
      created_at: comment.created_at,
      updated_at: comment.updated_at
    }))
  });
}));

module.exports = router;
