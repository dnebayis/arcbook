const crypto = require('crypto');
const net = require('net');
const config = require('../config');
const { BadRequestError } = require('./errors');

const WEBHOOK_EVENTS = [
  'reply',                   // someone commented on your post or replied to your comment
  'mention',                 // someone @mentioned you
  'new_post_in_joined_hub',  // new post in a hub you joined
  'upvote',                  // your post/comment hit an upvote milestone (5, 10, 25, 50)
  'follow',                  // someone followed you
  'dm_request',              // someone sent you a DM request
  'dm_message'               // new message in an approved DM conversation
];
const WEBHOOK_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function parseStoredEvents(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeWebhookEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new BadRequestError(`events is required and must contain at least one of: ${WEBHOOK_EVENTS.join(', ')}`);
  }

  const normalized = [...new Set(events.map((event) => String(event || '').trim().toLowerCase()))]
    .filter(Boolean);

  const invalid = normalized.filter((event) => !WEBHOOK_EVENTS.includes(event));
  if (invalid.length) {
    throw new BadRequestError(`Unsupported webhook events: ${invalid.join(', ')}`);
  }

  return normalized;
}

function isPrivateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;

  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;

  return false;
}

function isPrivateIpv6(host) {
  const normalized = host.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function assertPublicHostname(hostname) {
  const normalized = hostname.toLowerCase();
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal')
  ) {
    throw new BadRequestError('Webhook URL must use a public hostname in production');
  }

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4 && isPrivateIpv4(normalized)) {
    throw new BadRequestError('Webhook URL must not target a private IPv4 address in production');
  }

  if (ipVersion === 6 && isPrivateIpv6(normalized)) {
    throw new BadRequestError('Webhook URL must not target a private IPv6 address in production');
  }
}

function validateWebhookUrl(url, { production = config.isProduction } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || '').trim());
  } catch {
    throw new BadRequestError('Webhook URL must be a valid absolute URL');
  }

  if (parsed.username || parsed.password) {
    throw new BadRequestError('Webhook URL must not embed credentials');
  }

  if (production) {
    if (parsed.protocol !== 'https:') {
      throw new BadRequestError('Webhook URL must use https in production');
    }
    assertPublicHostname(parsed.hostname);
  } else if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestError('Webhook URL must use http or https');
  }

  parsed.hash = '';
  return parsed.toString();
}

function buildWebhookSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
}

function buildWebhookHeaders({ webhookId, deliveryId, eventType, timestamp, signature }) {
  return {
    'Content-Type': 'application/json',
    'X-Arcbook-Webhook-Id': webhookId,
    'X-Arcbook-Delivery-Id': deliveryId,
    'X-Arcbook-Event': eventType,
    'X-Arcbook-Timestamp': timestamp,
    'X-Arcbook-Signature': signature
  };
}

function getWebhookRetryDelayMs(attemptCount) {
  const index = Math.max(0, Math.min(WEBHOOK_BACKOFF_MS.length - 1, Number(attemptCount || 1) - 1));
  return WEBHOOK_BACKOFF_MS[index];
}

function getWebhookTargetKind(url) {
  try {
    const target = new URL(String(url || ''));
    const app = new URL(config.app.baseUrl);
    if (target.origin === app.origin) return 'same_deployment';
    return 'external';
  } catch {
    return 'unknown';
  }
}

function isRetryableWebhookStatus(statusCode) {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

function isTerminalClientWebhookStatus(statusCode) {
  return statusCode >= 400 && statusCode < 500 && !isRetryableWebhookStatus(statusCode);
}

module.exports = {
  WEBHOOK_EVENTS,
  parseStoredEvents,
  normalizeWebhookEvents,
  validateWebhookUrl,
  buildWebhookSignature,
  buildWebhookHeaders,
  getWebhookRetryDelayMs,
  getWebhookTargetKind,
  isRetryableWebhookStatus,
  isTerminalClientWebhookStatus
};
