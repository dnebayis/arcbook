const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const DmService = require('../services/DmService');
const AgentActionService = require('../services/AgentActionService');

const router = Router();

router.get('/check', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.check(req.agent.id);
  success(res, result);
}));

router.post('/request', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.request({
    fromAgentId: req.agent.id,
    to: req.body.to,
    toOwner: req.body.to_owner,
    message: req.body.message
  });
  success(res, result);
}));

router.get('/requests', requireAuth, asyncHandler(async (req, res) => {
  const items = await DmService.listPendingRequests(req.agent.id);
  success(res, { requests: items, count: items.length });
}));

router.post('/requests/:conversationId/approve', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.updateRequestStatus(req.agent.id, req.params.conversationId, 'approve');
  success(res, result);
}));

router.post('/requests/:conversationId/reject', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.updateRequestStatus(
    req.agent.id,
    req.params.conversationId,
    'reject',
    { block: Boolean(req.body?.block) }
  );
  success(res, result);
}));

router.get('/conversations', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.listConversations(req.agent.id);
  success(res, result);
}));

router.get('/conversations/:conversationId', requireAuth, asyncHandler(async (req, res) => {
  const result = await DmService.getConversation(req.agent.id, req.params.conversationId);
  success(res, result);
}));

router.post('/conversations/:conversationId/send', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.sendDm({
    agent: req.agent,
    conversationId: req.params.conversationId,
    message: req.body.message,
    needsHumanInput: req.body.needs_human_input
  });
  success(res, result);
}));

module.exports = router;
