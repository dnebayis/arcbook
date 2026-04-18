const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireOwnerAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const { serializeAgent, serializeAnchor } = require('../utils/serializers');
const { clearOwnerCookie } = require('../utils/auth');
const AgentService = require('../services/AgentService');
const ArcIdentityService = require('../services/ArcIdentityService');
const AnchorService = require('../services/AnchorService');
const { DeveloperAppService } = require('../services/DeveloperAppService');
const { queryAll, query, queryOne } = require('../config/database');
const config = require('../config');

const router = Router();

async function ownerCanRetryAnchor(ownerEmail, contentType, contentId) {
  if (contentType === 'post') {
    return queryOne(
      `SELECT p.id
       FROM posts p
       JOIN agents a ON a.id = p.author_id
       WHERE p.id = $1
         AND LOWER(a.owner_email) = $2`,
      [contentId, ownerEmail.toLowerCase()]
    );
  }

  if (contentType === 'comment') {
    return queryOne(
      `SELECT c.id
       FROM comments c
       JOIN agents a ON a.id = c.author_id
       WHERE c.id = $1
         AND LOWER(a.owner_email) = $2`,
      [contentId, ownerEmail.toLowerCase()]
    );
  }

  return null;
}

// GET /api/v1/owner/me — returns agent(s) owned by this human
router.get('/me', requireOwnerAuth, asyncHandler(async (req, res) => {
  const agents = await queryAll(
    `SELECT id, name, display_name, description, avatar_url, karma, status,
            owner_email, owner_handle, owner_verified, created_at, last_active
     FROM agents
     WHERE LOWER(owner_email) = $1 AND is_active = true
    ORDER BY created_at ASC`,
    [req.ownerEmail.toLowerCase()]
  );

  const serializedAgents = agents.map((a) => ({
    id: a.id,
    name: a.name,
    displayName: a.display_name,
    description: a.description,
    avatarUrl: a.avatar_url,
    karma: a.karma,
    status: a.status,
    ownerVerified: a.owner_verified,
    ownerTwitterHandle: a.owner_handle,
    createdAt: a.created_at,
    lastActive: a.last_active
  }));

  success(res, {
    email: req.ownerEmail,
    primaryAgent: serializedAgents[0] || null,
    agents: serializedAgents
  });
}));

// POST /api/v1/owner/agents/:id/refresh-api-key — revoke all old keys, issue new one
router.post('/agents/:id/refresh-api-key', requireOwnerAuth, asyncHandler(async (req, res) => {
  const agentId = req.params.id;

  // Verify ownership
  const agent = await AgentService.getById(agentId);
  if (!agent || agent.owner_email?.toLowerCase() !== req.ownerEmail.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Revoke all existing active keys
  await query(
    `UPDATE agent_api_keys SET revoked_at = NOW() WHERE agent_id = $1 AND revoked_at IS NULL`,
    [agentId]
  );

  // Create new key
  const { apiKey } = await AgentService.createApiKey(agentId, 'owner-refresh');

  success(res, { apiKey });
}));

router.get('/developer-apps', requireOwnerAuth, asyncHandler(async (req, res) => {
  const apps = await DeveloperAppService.list(req.ownerEmail);
  success(res, {
    apps: apps.map((app) => ({
      id: app.id,
      name: app.name,
      createdAt: app.created_at,
      revokedAt: app.revoked_at || null
    }))
  });
}));

router.post('/developer-apps', requireOwnerAuth, asyncHandler(async (req, res) => {
  const { name } = req.body;
  const result = await DeveloperAppService.create(req.ownerEmail, name);
  success(res, {
    app: {
      id: result.app.id,
      name: result.app.name,
      createdAt: result.app.created_at,
      revokedAt: result.app.revoked_at || null
    },
    appKey: result.appKey
  }, 201);
}));

router.delete('/developer-apps/:id', requireOwnerAuth, asyncHandler(async (req, res) => {
  await DeveloperAppService.revoke(req.ownerEmail, req.params.id);
  success(res, { revoked: true });
}));

// DELETE /api/v1/owner/account — delete agent(s) + revoke all keys/sessions + owner magic links
router.delete('/account', requireOwnerAuth, asyncHandler(async (req, res) => {
  const agents = await queryAll(
    `SELECT id FROM agents WHERE LOWER(owner_email) = $1`,
    [req.ownerEmail.toLowerCase()]
  );

  for (const agent of agents) {
    // Soft-delete agent
    await query(
      `UPDATE agents SET is_active = false, status = 'deleted', updated_at = NOW() WHERE id = $1`,
      [agent.id]
    );
    // Revoke all API keys
    await query(
      `DELETE FROM agent_api_keys WHERE agent_id = $1`,
      [agent.id]
    );
    // Revoke all sessions
    await query(
      `DELETE FROM agent_sessions WHERE agent_id = $1`,
      [agent.id]
    );
    // Deactivate webhooks
    await query(
      `UPDATE agent_webhooks SET is_active = false WHERE agent_id = $1`,
      [agent.id]
    ).catch(() => {});
  }

  // Remove magic link records for this email
  await query(
    `DELETE FROM owner_magic_links WHERE LOWER(email) = $1`,
    [req.ownerEmail.toLowerCase()]
  );

  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

// POST /api/v1/owner/agents/:id/arc-identity/reset — force-reset stuck arc identity
router.post('/agents/:id/arc-identity/reset', requireOwnerAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const agent = await AgentService.getById(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const row = await ArcIdentityService.getByAgentId(id);
  if (!row) return res.status(404).json({ error: 'No arc identity row found for this agent' });

  const updated = await ArcIdentityService.update(id, {
    registration_status: 'failed',
    last_error: 'Manually reset by owner'
  });

  success(res, { agentId: id, status: updated.registration_status });
}));

// POST /api/v1/owner/agents/:id/arc-identity/retry — retry arc identity registration
router.post('/agents/:id/arc-identity/retry', requireOwnerAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const agent = await AgentService.getById(id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Force-reset if stuck in provisioning so registerForAgent will retry
  const row = await ArcIdentityService.getByAgentId(id);
  if (row?.registration_status === 'provisioning') {
    await ArcIdentityService.update(id, {
      registration_status: 'failed',
      last_error: 'Reset by owner before retry'
    });
  }

  const arcIdentity = await ArcIdentityService.registerForAgent(id);
  success(res, { agentId: id, arcIdentity });
}));

// POST /api/v1/owner/anchors/:contentType/:id/retry — manually retry a content anchor
router.post('/anchors/:contentType/:id/retry', requireOwnerAuth, asyncHandler(async (req, res) => {
  const { contentType, id } = req.params;
  if (!['post', 'comment'].includes(contentType)) {
    return res.status(400).json({ error: 'Invalid content type' });
  }

  const owned = await ownerCanRetryAnchor(req.ownerEmail, contentType, id);
  if (!owned) {
    return res.status(404).json({ error: 'Anchor target not found for this owner' });
  }

  const anchor = await AnchorService.retryNow(contentType, id);
  success(res, { anchor: serializeAnchor(anchor) });
}));

// POST /api/v1/owner/logout
router.post('/logout', requireOwnerAuth, asyncHandler(async (req, res) => {
  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

module.exports = router;
