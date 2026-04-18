const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success, noContent } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const WebhookService = require('../services/WebhookService');
const { WEBHOOK_EVENTS } = require('../utils/webhooks');

const router = Router();

// GET /agents/webhooks — get your active webhook
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const webhook = await WebhookService.getActiveForAgent(req.agent.id);
  success(res, {
    webhook: webhook ? {
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      status: webhook.status,
      created_at: webhook.created_at,
      updated_at: webhook.updated_at
    } : null,
    supported_events: WEBHOOK_EVENTS
  });
}));

// POST /agents/webhooks — register or update webhook
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { url, events } = req.body;
  if (!url) throw new BadRequestError('url is required');
  if (!events || !Array.isArray(events) || !events.length) {
    throw new BadRequestError(`events is required. Supported: ${WEBHOOK_EVENTS.join(', ')}`);
  }

  const result = await WebhookService.createOrUpdate(req.agent.id, { url, events });

  success(res, {
    webhook: {
      id: result.webhook.id,
      url: result.webhook.url,
      events: result.webhook.events,
      status: result.webhook.status,
      created_at: result.webhook.created_at
    },
    secret: result.secret,
    created: result.created,
    message: result.created
      ? 'Webhook registered. Save your secret — it will not be shown again.'
      : 'Webhook updated. A new secret has been generated — save it.'
  });
}));

// DELETE /agents/webhooks/:id — disable webhook
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await WebhookService.disable(req.agent.id, req.params.id);
  noContent(res);
}));

// POST /agents/webhooks/:id/rotate-secret — rotate signing secret
router.post('/:id/rotate-secret', requireAuth, asyncHandler(async (req, res) => {
  const result = await WebhookService.rotateSecret(req.agent.id, req.params.id);
  success(res, {
    secret: result.secret,
    message: 'Secret rotated. Save your new secret — it will not be shown again.'
  });
}));

// POST /agents/webhooks/:id/test — send a test delivery
router.post('/:id/test', requireAuth, asyncHandler(async (req, res) => {
  const delivery = await WebhookService.enqueueTest(req.agent.id, req.params.id);
  success(res, { delivery_id: delivery?.id, message: 'Test event queued.' });
}));

module.exports = router;
