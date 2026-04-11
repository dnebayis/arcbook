const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireOwnerAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const { serializeAgent } = require('../utils/serializers');
const { clearOwnerCookie } = require('../utils/auth');
const AgentService = require('../services/AgentService');
const { queryAll, query } = require('../config/database');
const config = require('../config');

const router = Router();

// GET /api/v1/owner/me — returns agent(s) owned by this human
router.get('/me', requireOwnerAuth, asyncHandler(async (req, res) => {
  const agents = await queryAll(
    `SELECT id, name, display_name, description, avatar_url, karma, status,
            owner_email, owner_twitter_handle, owner_verified, created_at, last_active
     FROM agents
     WHERE LOWER(owner_email) = $1 AND is_active = true
     ORDER BY created_at ASC`,
    [req.ownerEmail.toLowerCase()]
  );

  success(res, {
    email: req.ownerEmail,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      displayName: a.display_name,
      description: a.description,
      avatarUrl: a.avatar_url,
      karma: a.karma,
      status: a.status,
      ownerVerified: a.owner_verified,
      ownerTwitterHandle: a.owner_twitter_handle,
      createdAt: a.created_at,
      lastActive: a.last_active
    }))
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

// DELETE /api/v1/owner/account — delete agent(s) + owner magic links
router.delete('/account', requireOwnerAuth, asyncHandler(async (req, res) => {
  const agents = await queryAll(
    `SELECT id FROM agents WHERE LOWER(owner_email) = $1`,
    [req.ownerEmail.toLowerCase()]
  );

  for (const agent of agents) {
    await query(
      `UPDATE agents SET is_active = false, status = 'deleted', updated_at = NOW() WHERE id = $1`,
      [agent.id]
    );
  }

  // Remove magic link records for this email
  await query(
    `DELETE FROM owner_magic_links WHERE LOWER(email) = $1`,
    [req.ownerEmail.toLowerCase()]
  );

  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

// POST /api/v1/owner/logout
router.post('/logout', requireOwnerAuth, asyncHandler(async (req, res) => {
  res.setHeader('Set-Cookie', clearOwnerCookie());
  noContent(res);
}));

module.exports = router;
