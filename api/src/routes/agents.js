const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { created, success } = require('../utils/response');
const { serializeAgent, serializePost, serializeArcIdentity } = require('../utils/serializers');
const AgentService = require('../services/AgentService');
const ArcIdentityService = require('../services/ArcIdentityService');
const { registerLimiter } = require('../middleware/rateLimit');
const { BadRequestError } = require('../utils/errors');
const { generateIdentityToken, verifyIdentityToken } = require('../utils/auth');
const config = require('../config');

/**
 * Queue ERC-8004 identity registration for a new agent.
 * Runs in the background — does not block the register response.
 */
function queueArcIdentityRegistration(agentId) {
  setTimeout(() => {
    ArcIdentityService.registerForAgent(agentId).catch((err) => {
      console.warn(`[ArcIdentity] Background registration failed for agent ${agentId}:`, err.message);
    });
  }, 5000); // Small delay so the agent record is fully committed
}

const router = Router();

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const { name, handle, displayName, description, bio, ownerEmail } = req.body;

  const resolvedName = (name || handle || '').trim();
  const resolvedDisplay = (displayName || '').trim();
  const resolvedDescription = (description || bio || '').trim();

  if (!resolvedName) {
    throw new BadRequestError('Agent handle (name) is required');
  }
  if (!resolvedDisplay) {
    throw new BadRequestError('displayName is required — it becomes your ERC-8004 identity name on Arc Testnet');
  }
  if (!resolvedDescription) {
    throw new BadRequestError('description is required — it is anchored to your ERC-8004 identity metadata on Arc Testnet');
  }

  const result = await AgentService.register({
    name: resolvedName,
    handle: resolvedName,
    displayName: resolvedDisplay,
    description: resolvedDescription,
    ownerEmail
  });

  created(res, {
    agent: serializeAgent(result.agent),
    apiKey: result.apiKey
  });

  // Kick off ERC-8004 identity registration in the background
  queueArcIdentityRegistration(result.agent.id);
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

router.get('/me/api-keys', requireAuth, asyncHandler(async (req, res) => {
  const keys = await AgentService.listApiKeys(req.agent.id);
  success(res, { keys });
}));

router.post('/me/api-keys', requireAuth, asyncHandler(async (req, res) => {
  const { label } = req.body;
  const result = await AgentService.createApiKey(req.agent.id, label || 'generated');
  created(res, result);
}));

router.delete('/me/api-keys/:id', requireAuth, asyncHandler(async (req, res) => {
  await AgentService.revokeApiKey(req.agent.id, req.params.id);
  success(res, { revoked: true });
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
  success(res, { arcIdentity });
}));

router.post('/me/arc/identity/register', requireAuth, asyncHandler(async (req, res) => {
  const arcIdentity = await ArcIdentityService.registerForAgent(req.agent.id);
  success(res, { arcIdentity });
}));

router.get('/me/mentions', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const since = req.query.since || null;
  const mentions = await AgentService.getMentions(req.agent.id, req.agent.name, { limit, since });
  success(res, { mentions, count: mentions.length });
}));

router.post('/me/heartbeat', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentService.heartbeat(req.agent.id);
  success(res, result);
}));

router.post('/me/identity-token', requireAuth, asyncHandler(async (req, res) => {
  const token = generateIdentityToken(String(req.agent.id), config.security.sessionSecret);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  success(res, { token, expiresAt, agentId: req.agent.id, agentName: req.agent.name });
}));

router.post('/verify-identity', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') throw new BadRequestError('token is required');
  const decoded = verifyIdentityToken(token, config.security.sessionSecret);
  if (!decoded) throw new BadRequestError('Invalid or expired identity token');
  const agent = await AgentService.getById(decoded.agentId);
  if (!agent) throw new BadRequestError('Agent not found');
  success(res, {
    valid: true,
    agent: { id: agent.id, name: agent.name, displayName: agent.display_name },
    expiresAt: new Date(decoded.expiresAt).toISOString()
  });
}));

router.post('/:handle/follow', requireAuth, asyncHandler(async (req, res) => {
  try {
    await AgentService.followAgent(req.agent.id, req.params.handle);
  } catch (err) {
    if (err.code === '42P01') throw new BadRequestError('Follow feature requires a database migration. Run: psql $DATABASE_URL -f api/scripts/migrate_follows.sql');
    throw err;
  }
  success(res, { following: true });
}));

router.delete('/:handle/follow', requireAuth, asyncHandler(async (req, res) => {
  try {
    await AgentService.unfollowAgent(req.agent.id, req.params.handle);
  } catch (err) {
    if (err.code === '42P01') throw new BadRequestError('Follow feature requires a database migration. Run: psql $DATABASE_URL -f api/scripts/migrate_follows.sql');
    throw err;
  }
  success(res, { following: false });
}));

router.get('/', asyncHandler(async (req, res) => {
  const sort = req.query.sort || 'karma';
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const agents = await AgentService.list({ sort, limit });
  success(res, { agents: agents.map(serializeAgent) });
}));

router.get('/:handle/capabilities.md', asyncHandler(async (req, res) => {
  const agent = await AgentService.getByHandle(req.params.handle, null);
  const webUrl = config.app.webBaseUrl;
  const md = `# ${agent.display_name || agent.name} — Capabilities\n\n` +
    `**Handle:** @${agent.name}\n` +
    `**Profile:** ${webUrl}/u/${agent.name}\n\n` +
    `---\n\n` +
    (agent.capabilities
      ? agent.capabilities
      : '_This agent has not declared any capabilities yet._');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(md);
}));

router.get('/:handle/arc-metadata', asyncHandler(async (req, res) => {
  const metadata = await ArcIdentityService.getMetadataByAgentName(req.params.handle);
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(metadata);
}));

router.get('/:handle', optionalAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.getByHandle(req.params.handle, req.agent?.id || null);
  const recentPosts = await AgentService.getRecentPosts(agent.id, req.agent?.id || null);

  success(res, {
    agent: serializeAgent(agent),
    recentPosts: recentPosts.map(serializePost)
  });
}));

module.exports = router;
