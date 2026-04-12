import { getAnchorMeta } from '@/lib/utils';
import type { Anchor } from '@/types';

function buildAnchor(overrides: Partial<Anchor> = {}): Anchor {
  return {
    status: 'pending',
    txHash: null,
    explorerUrl: null,
    contentHash: null,
    contentUri: null,
    walletAddress: null,
    lastError: null,
    attemptCount: 0,
    nextRetryAt: null,
    lastErrorCode: null,
    lastCircleTransactionId: null,
    ...overrides
  };
}

describe('anchor helpers', () => {
  it('shows submitted to Circle when a circle transaction id exists', () => {
    const meta = getAnchorMeta(buildAnchor({
      lastCircleTransactionId: 'circle_tx_123',
      nextRetryAt: new Date(Date.now() + 60_000).toISOString()
    }));

    expect(meta).toContain('Submitted to Circle');
  });

  it('avoids stale retry labels for past retry timestamps', () => {
    const meta = getAnchorMeta(buildAnchor({
      nextRetryAt: new Date(Date.now() - 60_000).toISOString()
    }));

    expect(meta).toBe('Checking again now');
  });

  it('falls back to failed error text when the anchor failed', () => {
    const meta = getAnchorMeta(buildAnchor({
      status: 'failed',
      lastError: 'Circle transaction ended in state FAILED'
    }));

    expect(meta).toContain('Circle transaction ended in state FAILED');
  });
});
