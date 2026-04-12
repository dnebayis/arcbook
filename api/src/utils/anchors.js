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

  if (normalized.includes('rate limit') || normalized.includes('429')) {
    return {
      code: 'provider_rate_limited',
      retryable: true,
      message: combined || 'Upstream provider rate limited the transaction'
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
  getAnchorRetryDelayMs,
  classifyAnchorFailure
};
