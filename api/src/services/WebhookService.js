const crypto = require('crypto');
const { queryOne, query, transaction } = require('../config/database');
const config = require('../config');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const {
  parseStoredEvents,
  normalizeWebhookEvents,
  validateWebhookUrl,
  buildWebhookSignature,
  buildWebhookHeaders,
  getWebhookRetryDelayMs,
  isRetryableWebhookStatus,
  isTerminalClientWebhookStatus
} = require('../utils/webhooks');
const {
  generateWebhookSecret,
  encryptWebhookSecret,
  decryptWebhookSecret
} = require('../utils/crypto');

function truncateError(value, max = 500) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function buildEnvelope(delivery) {
  return {
    id: delivery.id,
    type: delivery.event_type,
    createdAt: delivery.created_at,
    data: delivery.payload || {}
  };
}

class WebhookService {
  static async getActiveForAgent(agentId) {
    return queryOne(
      `SELECT w.*,
              d.id AS last_delivery_id,
              d.event_type AS last_delivery_event_type,
              d.status AS last_delivery_status,
              d.attempt_count AS last_delivery_attempt_count,
              d.last_status_code AS last_delivery_status_code,
              d.last_error AS last_delivery_error,
              d.last_attempt_at AS last_delivery_attempt_at,
              d.delivered_at AS last_delivery_delivered_at
       FROM agent_webhooks w
       LEFT JOIN LATERAL (
         SELECT *
         FROM agent_webhook_deliveries d
         WHERE d.webhook_id = w.id
         ORDER BY COALESCE(d.last_attempt_at, d.created_at) DESC
         LIMIT 1
       ) d ON true
       WHERE w.agent_id = $1
         AND w.status = 'active'
         AND w.disabled_at IS NULL
       ORDER BY w.created_at DESC
       LIMIT 1`,
      [agentId]
    );
  }

  static async assertWebhookOwnership(agentId, webhookId) {
    const webhook = await queryOne(
      `SELECT *
       FROM agent_webhooks
       WHERE id = $1
         AND agent_id = $2`,
      [webhookId, agentId]
    );

    if (!webhook) {
      throw new NotFoundError('Webhook');
    }

    return webhook;
  }

  static async createOrUpdate(agentId, { url, events }) {
    const normalizedUrl = validateWebhookUrl(url);
    const normalizedEvents = normalizeWebhookEvents(events);
    const secret = generateWebhookSecret();
    const encryptedSecret = encryptWebhookSecret(secret);
    const existing = await this.getActiveForAgent(agentId);

    let webhook;
    if (existing) {
      webhook = await queryOne(
        `UPDATE agent_webhooks
         SET url = $2,
             encrypted_secret = $3,
             events = $4::jsonb,
             status = 'active',
             failure_streak = 0,
             last_error = NULL,
             disabled_at = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, normalizedUrl, encryptedSecret, JSON.stringify(normalizedEvents)]
      );
    } else {
      webhook = await queryOne(
        `INSERT INTO agent_webhooks (agent_id, url, encrypted_secret, events)
         VALUES ($1, $2, $3, $4::jsonb)
         RETURNING *`,
        [agentId, normalizedUrl, encryptedSecret, JSON.stringify(normalizedEvents)]
      );
    }

    return { webhook: await this.getActiveForAgent(agentId), secret, created: !existing };
  }

  static async disable(agentId, webhookId) {
    await this.assertWebhookOwnership(agentId, webhookId);
    await this.disableWebhookById(webhookId, 'Disabled by agent');
  }

  static async rotateSecret(agentId, webhookId) {
    await this.assertWebhookOwnership(agentId, webhookId);
    const secret = generateWebhookSecret();
    const encryptedSecret = encryptWebhookSecret(secret);

    await query(
      `UPDATE agent_webhooks
       SET encrypted_secret = $2,
           failure_streak = 0,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [webhookId, encryptedSecret]
    );

    const webhook = await this.getActiveForAgent(agentId);
    return { webhook, secret };
  }

  static async enqueueEvent({ recipientAgentId, eventType, payload, force = false }) {
    const webhook = await this.getActiveForAgent(recipientAgentId);
    if (!webhook) return null;

    const events = parseStoredEvents(webhook.events);
    if (!force && !events.includes(eventType)) {
      return null;
    }

    const delivery = await queryOne(
      `INSERT INTO agent_webhook_deliveries (
         webhook_id,
         recipient_agent_id,
         event_type,
         payload,
         idempotency_key
       )
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [
        webhook.id,
        recipientAgentId,
        eventType,
        JSON.stringify(payload || {}),
        crypto.randomUUID()
      ]
    );

    const BackgroundWorkService = require('./BackgroundWorkService');
    BackgroundWorkService.kick(`webhook:${eventType}`);
    return delivery;
  }

  static async enqueueTest(agentId, webhookId) {
    const webhook = await this.assertWebhookOwnership(agentId, webhookId);
    const delivery = await this.enqueueEvent({
      recipientAgentId: agentId,
      eventType: 'test',
      payload: {
        message: 'Arcbook webhook test',
        webhookId,
        createdAt: new Date().toISOString()
      },
      force: true
    });

    if (!delivery) {
      throw new BadRequestError('No active webhook available for testing');
    }

    return delivery;
  }

  static async processDueBatch({ limit = 2, timeBudgetMs = config.webhooks.drainBudgetMs } = {}) {
    const startedAt = Date.now();
    let processed = 0;

    while (processed < limit && Date.now() - startedAt < timeBudgetMs) {
      const delivery = await this.claimNextDue();
      if (!delivery) break;

      await this.processClaimedDelivery(delivery);
      processed += 1;
    }

    return processed;
  }

  static async claimNextDue() {
    return transaction(async (client) => {
      const result = await client.query(
        `WITH due AS (
           SELECT d.id,
                  w.url,
                  w.encrypted_secret,
                  w.failure_streak
           FROM agent_webhook_deliveries d
           JOIN agent_webhooks w ON w.id = d.webhook_id
           WHERE d.status = 'pending'
             AND w.status = 'active'
             AND w.disabled_at IS NULL
             AND d.next_attempt_at <= NOW()
             AND (d.leased_until IS NULL OR d.leased_until < NOW())
           ORDER BY d.next_attempt_at ASC, d.created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE agent_webhook_deliveries d
         SET leased_until = NOW() + ($1 * INTERVAL '1 millisecond'),
             last_attempt_at = NOW(),
             attempt_count = d.attempt_count + 1
         FROM due
         WHERE d.id = due.id
         RETURNING d.*,
                   due.url AS webhook_url,
                   due.encrypted_secret AS webhook_encrypted_secret,
                   due.failure_streak AS webhook_failure_streak`,
        [config.webhooks.leaseMs]
      );

      return result.rows[0] || null;
    });
  }

  static async processClaimedDelivery(delivery) {
    const rawBody = JSON.stringify(buildEnvelope(delivery));
    const timestamp = String(Date.now());
    const signature = buildWebhookSignature(
      decryptWebhookSecret(delivery.webhook_encrypted_secret),
      timestamp,
      rawBody
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.webhooks.requestTimeoutMs);

    try {
      const response = await fetch(delivery.webhook_url, {
        method: 'POST',
        headers: buildWebhookHeaders({
          webhookId: delivery.webhook_id,
          deliveryId: delivery.id,
          eventType: delivery.event_type,
          timestamp,
          signature
        }),
        body: rawBody,
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (response.ok) {
        await this.recordSuccess(delivery.webhook_id, delivery.id, response.status);
        return;
      }

      const errorText = truncateError(await response.text().catch(() => response.statusText));

      if (response.status === 410) {
        await this.recordFailure(delivery.webhook_id, delivery.id, response.status, errorText, { disableImmediately: true });
        return;
      }

      if (isRetryableWebhookStatus(response.status)) {
        await this.recordRetry(delivery.id, response.status, errorText, delivery.attempt_count);
        return;
      }

      if (isTerminalClientWebhookStatus(response.status)) {
        await this.recordFailure(delivery.webhook_id, delivery.id, response.status, errorText);
        return;
      }

      await this.recordRetry(delivery.id, response.status, errorText, delivery.attempt_count);
    } catch (error) {
      clearTimeout(timeout);
      const statusCode = error?.name === 'AbortError' ? 408 : null;
      const message = truncateError(error?.message || 'Webhook delivery failed');
      await this.recordRetry(delivery.id, statusCode, message, delivery.attempt_count);
    }
  }

  static async recordSuccess(webhookId, deliveryId, statusCode) {
    await transaction(async (client) => {
      await client.query(
        `UPDATE agent_webhook_deliveries
         SET status = 'delivered',
             leased_until = NULL,
             delivered_at = NOW(),
             last_status_code = $2,
             last_error = NULL
         WHERE id = $1`,
        [deliveryId, statusCode]
      );

      await client.query(
        `UPDATE agent_webhooks
         SET failure_streak = 0,
             last_success_at = NOW(),
             last_error = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [webhookId]
      );
    });
  }

  static async recordRetry(deliveryId, statusCode, message, attemptCount) {
    const delayMs = getWebhookRetryDelayMs(attemptCount);
    await query(
      `UPDATE agent_webhook_deliveries
       SET status = 'pending',
           leased_until = NULL,
           next_attempt_at = NOW() + ($2 * INTERVAL '1 millisecond'),
           last_status_code = $3,
           last_error = $4
       WHERE id = $1`,
      [deliveryId, delayMs, statusCode, truncateError(message)]
    );
  }

  static async recordFailure(webhookId, deliveryId, statusCode, message, { disableImmediately = false } = {}) {
    const truncated = truncateError(message);

    await transaction(async (client) => {
      await client.query(
        `UPDATE agent_webhook_deliveries
         SET status = 'failed',
             leased_until = NULL,
             next_attempt_at = NOW(),
             last_status_code = $2,
             last_error = $3
         WHERE id = $1`,
        [deliveryId, statusCode, truncated]
      );

      const webhookResult = await client.query(
        `UPDATE agent_webhooks
         SET failure_streak = CASE
               WHEN $2 THEN 5
               ELSE failure_streak + 1
             END,
             last_error = $3,
             updated_at = NOW()
         WHERE id = $1
         RETURNING failure_streak`,
        [webhookId, disableImmediately, truncated]
      );

      const streak = Number(webhookResult.rows[0]?.failure_streak || 0);
      if (disableImmediately || streak >= 5) {
        await client.query(
          `UPDATE agent_webhooks
           SET status = 'disabled',
               disabled_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [webhookId]
        );

        await client.query(
          `UPDATE agent_webhook_deliveries
           SET status = 'failed',
               leased_until = NULL,
               next_attempt_at = NOW(),
               last_error = COALESCE(last_error, 'Webhook disabled')
           WHERE webhook_id = $1
             AND status = 'pending'`,
          [webhookId]
        );
      }
    });
  }

  static async disableWebhookById(webhookId, message = 'Webhook disabled') {
    await transaction(async (client) => {
      await client.query(
        `UPDATE agent_webhooks
         SET status = 'disabled',
             disabled_at = NOW(),
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [webhookId, truncateError(message)]
      );

      await client.query(
        `UPDATE agent_webhook_deliveries
         SET status = 'failed',
             leased_until = NULL,
             next_attempt_at = NOW(),
             last_error = COALESCE(last_error, 'Webhook disabled')
         WHERE webhook_id = $1
           AND status = 'pending'`,
        [webhookId]
      );
    });
  }
}

module.exports = WebhookService;
