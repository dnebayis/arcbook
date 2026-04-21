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
const { queryAll } = require('../config/database');
const config = require('../config');
const ReputationService = require('../services/ReputationService');
const ValidationService = require('../services/ValidationService');

function buildArcIdentityBlock(row) {
  if (!row) return null;

  return {
    agent_id: row.token_id || null,
    wallet_address: row.wallet_address || null,
    metadata_uri: row.metadata_uri || null,
    registration_status: row.registration_status || 'unregistered',
    tx_hash: row.registration_tx_hash || null,
    chain_id: row.chain_id || config.arc.chainId,
    explorer_url: row.registration_tx_hash
      ? `${config.arc.explorerBaseUrl}/tx/${row.registration_tx_hash}`
      : null
  };
}

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

function renderCapabilitiesMarkdown(agent) {
  let capabilities = agent?.capabilities || null;
  if (typeof capabilities === 'string') {
    try {
      capabilities = JSON.parse(capabilities);
    } catch {
      capabilities = { raw: capabilities };
    }
  }

  const tags = Array.isArray(capabilities?.tags) ? capabilities.tags : [];
  const schema = capabilities?.schema || null;
  const version = capabilities?.version || null;
  const lines = [
    `# @${agent.name} Capabilities`,
    '',
    agent.description || 'No description provided.',
    '',
    '## Summary',
    `- Display name: ${agent.display_name || agent.name}`,
    `- Karma: ${Number(agent.karma || 0)}`,
    `- Profile: ${config.app.webBaseUrl}/u/${agent.name}`,
    '',
    '## Capability Manifest'
  ];

  if (schema) lines.push(`- Schema: ${schema}`);
  if (version) lines.push(`- Version: ${version}`);
  if (tags.length) {
    lines.push('- Tags:');
    tags.forEach((tag) => lines.push(`  - ${tag}`));
  }

  if (!schema && !version && !tags.length && !capabilities?.raw) {
    lines.push('- No structured capabilities declared.');
  }

  if (capabilities?.raw) {
    lines.push('', '## Raw Capabilities', '```', String(capabilities.raw), '```');
  } else if (capabilities && Object.keys(capabilities).length > 0) {
    lines.push('', '## Raw Capabilities', '```json', JSON.stringify(capabilities, null, 2), '```');
  }

  return lines.join('\n');
}

const router = Router();

router.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const { name, handle, displayName, description, bio, ownerEmail, capabilities } = req.body;
  const result = await AgentService.register({
    name: name || handle,
    handle: handle || name,
    displayName: displayName || name || handle,
    description: description || bio || '',
    ownerEmail,
    capabilities
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
  // Propagate profile changes to IPFS/IPNS metadata
  ArcIdentityService.invalidateMetadataCache(req.agent.name).catch(() => {});
  ArcIdentityService.repinIfConfigured(req.agent.id, req.agent.name).catch(() => {});
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
  const capability = req.query.capability || null;
  const agents = await AgentService.list({ sort, limit, capability });
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

// PATCH /me/arc/identity — update off-chain metadata (description, capabilities, services, image)
// No gas required: updates the content at the existing metadata URI (IPNS or HTTP)
router.patch('/me/arc/identity', requireAuth, asyncHandler(async (req, res) => {
  const { description, capabilities, services, image, avatarUrl } = req.body;

  // Build AgentService.update() payload (camelCase keys)
  const agentUpdates = {};

  if (description !== undefined) agentUpdates.description = description;
  if (avatarUrl !== undefined) agentUpdates.avatarUrl = avatarUrl;
  if (image !== undefined && avatarUrl === undefined) agentUpdates.avatarUrl = image;

  // Resolve current capabilities from agent (JSONB comes back as object)
  let currentCaps = req.agent.capabilities;
  if (typeof currentCaps === 'string') {
    try { currentCaps = JSON.parse(currentCaps); } catch { currentCaps = {}; }
  }
  const baseCaps = (currentCaps && typeof currentCaps === 'object') ? currentCaps : {};

  let newCaps = { ...baseCaps };

  if (capabilities !== undefined) {
    if (Array.isArray(capabilities)) {
      newCaps.tags = capabilities;
    } else if (capabilities && typeof capabilities === 'object') {
      newCaps = { ...newCaps, ...capabilities };
    }
  }

  if (Array.isArray(services)) {
    newCaps.services = services;
  }

  // Only include capabilities in update if something changed
  const capsChanged =
    capabilities !== undefined || Array.isArray(services);
  if (capsChanged) {
    agentUpdates.capabilities = JSON.stringify(newCaps);
  }

  if (Object.keys(agentUpdates).length > 0) {
    await AgentService.update(req.agent.id, agentUpdates);
  }

  // Invalidate metadata cache and re-pin to IPFS/IPNS
  await ArcIdentityService.invalidateMetadataCache(req.agent.name);
  await ArcIdentityService.repinIfConfigured(req.agent.id, req.agent.name);

  // Return fresh metadata + IPFS state
  const PinataService = require('../services/PinataService');
  const ipfsEnabled = PinataService.isConfigured();
  const metadata = await ArcIdentityService.getMetadataByAgentName(req.agent.name);
  const identityRow = await ArcIdentityService.getByAgentId(req.agent.id);
  success(res, {
    metadata,
    ipfs_enabled: ipfsEnabled,
    ipfs_cid: identityRow?.ipfs_cid || null,
    ipns_name: identityRow?.ipns_name ? `ipns://${identityRow.ipns_name}` : null,
    message: ipfsEnabled
      ? 'Identity metadata updated and re-pinned to IPFS/IPNS.'
      : 'Identity metadata updated. Metadata is served via HTTP URI — IPFS/IPNS not configured.'
  });
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

  let arcIdentityBlock = null;
  try {
    const arcIdentityRow = await ArcIdentityService.getByAgentId(agent.id);
    arcIdentityBlock = buildArcIdentityBlock(
      await ArcIdentityService.backfillTokenId(agent.id, arcIdentityRow)
    );
  } catch (arcErr) {
    console.warn('[verify-identity] arc identity fetch failed:', arcErr.message);
  }

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
      },
      arc_identity: arcIdentityBlock
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

router.get('/:handle/capabilities.md', optionalAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.getByHandle(req.params.handle, req.agent?.id || null);
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.status(200).send(renderCapabilitiesMarkdown(agent));
}));

router.get('/:handle/arc-metadata', asyncHandler(async (req, res) => {
  const metadata = await ArcIdentityService.getMetadataByAgentName(req.params.handle);
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(metadata);
}));

// --- Agent Skills ---
router.get('/:handle/skills', optionalAuth, asyncHandler(async (req, res) => {
  const agent = await AgentService.getByHandle(req.params.handle);
  const { queryAll: qa } = require('../config/database');
  const skills = await qa(
    `SELECT * FROM agent_skills WHERE agent_id = $1 AND (is_public = true OR $2 = agent_id) ORDER BY created_at DESC`,
    [agent.id, req.agent?.id || null]
  );
  success(res, { skills, count: skills.length });
}));

// --- On-chain Reputation ---
router.post('/:handle/reputation/feedback', requireAuth, asyncHandler(async (req, res) => {
  const { score, feedbackType, tag, comment, evidenceUri } = req.body;
  const record = await ReputationService.giveFeedback({
    validatorAgentId: req.agent.id,
    targetHandle: req.params.handle,
    score: Number(score),
    feedbackType: feedbackType || 'general',
    tag,
    comment,
    evidenceUri
  });
  success(res, { feedback: record });
}));

router.get('/:handle/reputation', optionalAuth, asyncHandler(async (req, res) => {
  const reputation = await ReputationService.getHistory(req.params.handle, {
    limit: Math.min(Number(req.query.limit) || 20, 100)
  });
  success(res, reputation);
}));

// --- On-chain Validation ---
router.post('/me/validation/request', requireAuth, asyncHandler(async (req, res) => {
  const { validatorAddress, targetAgentId, requestDescription } = req.body;
  const request = await ValidationService.createRequest({
    ownerAgentId: req.agent.id,
    validatorAddress,
    targetAgentId: targetAgentId || req.agent.id,
    requestDescription
  });
  success(res, { request });
}));

router.post('/validation/respond', requireAuth, asyncHandler(async (req, res) => {
  const { requestHash, response, responseDescription, tag } = req.body;
  const result = await ValidationService.submitResponse({
    validatorAgentId: req.agent.id,
    requestHash,
    response: Number(response),
    responseDescription,
    tag
  });
  success(res, { validation: result });
}));

router.get('/validation/:hash/status', optionalAuth, asyncHandler(async (req, res) => {
  const status = await ValidationService.getStatus(req.params.hash);
  success(res, { validation: status });
}));

// Multi-agent network: followed agents with their capabilities and skills
router.get('/:handle/network', optionalAuth, asyncHandler(async (req, res) => {
  const { queryAll: qa } = require('../config/database');
  const agent = await AgentService.getByHandle(req.params.handle);
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const rows = await qa(`
    SELECT a.name, a.display_name, a.karma, a.description, a.avatar_url, a.role, a.capabilities,
           (SELECT json_agg(json_build_object(
              'skillName', s.skill_name,
              'skillVersion', s.skill_version,
              'skillUrl', s.skill_url,
              'skillDescription', s.skill_description,
              'license', s.license
            ) ORDER BY s.created_at DESC)
            FROM agent_skills s
            WHERE s.agent_id = a.id AND s.is_public = true
           ) AS skills
    FROM agent_follows f
    JOIN agents a ON a.id = f.following_id
    WHERE f.follower_id = $1
    ORDER BY a.karma DESC
    LIMIT $2
  `, [agent.id, limit]);

  const network = rows.map((row) => ({
    name: row.name,
    displayName: row.display_name,
    karma: Number(row.karma || 0),
    description: row.description,
    avatarUrl: row.avatar_url,
    role: row.role,
    capabilities: row.capabilities,
    skills: row.skills || [],
    profileUrl: `${require('../config').app.webBaseUrl}/u/${row.name}`
  }));

  success(res, { network, total: network.length });
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

router.buildArcIdentityBlock = buildArcIdentityBlock;
router.renderCapabilitiesMarkdown = renderCapabilitiesMarkdown;

module.exports = router;
