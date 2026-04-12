const crypto = require('crypto');

const ANCHOR_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

function getAnchorRetryDelayMs(attemptCount) {
  const index = Math.max(0, Math.min(ANCHOR_BACKOFF_MS.length - 1, Number(attemptCount || 1) - 1));
  return ANCHOR_BACKOFF_MS[index];
}

function combineErrorDetails(error, transaction = null) {
  const details = [
    error?.message,
    error?.code,
    transaction?.state,
    transaction?.errorReason,
    transaction?.failureReason,
    transaction?.errorDetails,
    transaction?.failureDetails,
    transaction?.message,
    transaction?.description
  ].filter(Boolean);

  return details.join(' | ');
}

function buildAnchorIdempotencyKey(contentType, contentId, contentHash) {
  const digest = crypto
    .createHash('sha256')
    .update(`${contentType}:${contentId}:${String(contentHash || '').toLowerCase()}`)
    .digest('hex');

  // Circle validates idempotency keys as UUIDs for mutating wallet calls.
  // We still need the key to be deterministic per content payload so retries
  // resume the same request instead of creating duplicate contract executions.
  const raw = digest.slice(0, 32).split('');
  raw[12] = '4'; // UUID version 4
  raw[16] = ['8', '9', 'a', 'b'][parseInt(raw[16], 16) % 4]; // RFC 4122 variant

  return [
    raw.slice(0, 8).join(''),
    raw.slice(8, 12).join(''),
    raw.slice(12, 16).join(''),
    raw.slice(16, 20).join(''),
    raw.slice(20, 32).join('')
  ].join('-');
}

function classifyAnchorFailure(error, transaction = null) {
  const combined = combineErrorDetails(error, transaction);
  const normalized = combined.toLowerCase();

  if (
    normalized.includes('arc_content_registry_address') ||
    normalized.includes('content registry') && normalized.includes('not configured') ||
    normalized.includes('missing circle configuration') ||
    normalized.includes('public_api_url') && normalized.includes('must be a valid url')
  ) {
    return {
      code: 'blocked_config',
      retryable: false,
      message: combined || 'ARC content registry is not configured'
    };
  }

  if (normalized.includes('insufficient') || normalized.includes('asset amount owned by the wallet is insufficient')) {
    return {
      code: 'insufficient_funds',
      retryable: true,
      message: combined || 'The wallet balance is insufficient for the transaction'
    };
  }

  if (normalized.includes('timeout')) {
    return {
      code: 'upstream_timeout',
      retryable: true,
      message: combined || 'Upstream transaction polling timed out'
    };
  }

  if (
    normalized.includes('econnreset') ||
    normalized.includes('socket hang up') ||
    normalized.includes('connection reset') ||
    normalized.includes('network error') ||
    normalized.includes('fetch failed')
  ) {
    return {
      code: 'network_reset',
      retryable: true,
      message: combined || 'A transient network reset interrupted anchor processing'
    };
  }

  if (normalized.includes('rate limit') || normalized.includes('429')) {
    return {
      code: 'provider_rate_limited',
      retryable: true,
      message: combined || 'Upstream provider rate limited the transaction'
    };
  }

  if (
    normalized.includes('already anchored')
  ) {
    return {
      code: 'already_anchored',
      retryable: false,
      message: combined || 'This content is already anchored on-chain'
    };
  }

  if (
    normalized.includes('execution reverted') ||
    normalized.includes('revert') ||
    normalized.includes('invalid opcode') ||
    normalized.includes('abi') ||
    normalized.includes('contract function')
  ) {
    return {
      code: 'blocked_contract',
      retryable: false,
      message: combined || 'The contract execution failed deterministically'
    };
  }

  if (
    normalized.includes('failed') ||
    normalized.includes('denied') ||
    normalized.includes('cancelled')
  ) {
    return {
      code: 'provider_failed',
      retryable: true,
      message: combined || 'The upstream provider returned a failed transaction state'
    };
  }

  return {
    code: 'unknown',
    retryable: true,
    message: combined || 'Unknown anchor processing failure'
  };
}

module.exports = {
  buildAnchorIdempotencyKey,
  getAnchorRetryDelayMs,
  classifyAnchorFailure
};
