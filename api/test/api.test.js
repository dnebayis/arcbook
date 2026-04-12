/**
 * Arcbook API Test Suite
 *
 * Run: npm test
 */

const { 
  generateApiKey, 
  generateSessionToken,
  validateApiKey,
  extractToken,
  hashToken
} = require('../src/utils/auth');
const {
  generateClaimTokenPayload,
  classifyClaimTokenRecord
} = require('../src/utils/claimTokens');
const {
  normalizeWebhookEvents,
  validateWebhookUrl,
  buildWebhookSignature,
  getWebhookRetryDelayMs,
  getWebhookTargetKind
} = require('../src/utils/webhooks');
const {
  buildAnchorIdempotencyKey,
  classifyAnchorFailure,
  getAnchorRetryDelayMs
} = require('../src/utils/anchors');
const config = require('../src/config');

const {
  ApiError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError
} = require('../src/utils/errors');

// Test framework
let passed = 0;
let failed = 0;
const tests = [];

function describe(name, fn) {
  tests.push({ type: 'describe', name });
  fn();
}

function test(name, fn) {
  tests.push({ type: 'test', name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

async function runTests() {
  console.log('\nArcbook API Test Suite\n');
  console.log('='.repeat(50));

  for (const item of tests) {
    if (item.type === 'describe') {
      console.log(`\n[${item.name}]\n`);
    } else {
      try {
        await item.fn();
        console.log(`  + ${item.name}`);
        passed++;
      } catch (error) {
        console.log(`  - ${item.name}`);
        console.log(`    Error: ${error.message}`);
        failed++;
      }
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

// Tests

describe('Auth Utils', () => {
  test('generateApiKey creates valid key', () => {
    const key = generateApiKey();
    const expectedLength = config.auth.tokenPrefix.length + (config.auth.apiKeyBytes * 2);
    assert(key.startsWith('arcbook_'), 'Should have correct prefix');
    assertEqual(key.length, expectedLength, 'Should have correct length');
  });

  test('generateSessionToken creates valid token', () => {
    const token = generateSessionToken();
    assert(token.startsWith('session_'), 'Should have correct prefix');
  });

  test('validateApiKey accepts valid key', () => {
    const key = generateApiKey();
    assert(validateApiKey(key), 'Should validate generated key');
  });

  test('validateApiKey rejects invalid key', () => {
    assert(!validateApiKey('invalid'), 'Should reject invalid');
    assert(!validateApiKey(null), 'Should reject null');
    assert(!validateApiKey('arcbook_short'), 'Should reject short key');
  });

  test('extractToken extracts from Bearer header', () => {
    const token = extractToken('Bearer arcbook_test123');
    assertEqual(token, 'arcbook_test123');
  });

  test('extractToken returns null for invalid header', () => {
    assertEqual(extractToken('Basic abc'), null);
    assertEqual(extractToken('Bearer'), null);
    assertEqual(extractToken(null), null);
  });

  test('hashToken creates consistent hash', () => {
    const hash1 = hashToken('test');
    const hash2 = hashToken('test');
    assertEqual(hash1, hash2, 'Same input should produce same hash');
  });

  test('generateClaimTokenPayload creates raw token and hash', () => {
    const { token, tokenHash } = generateClaimTokenPayload();
    assertEqual(token.length, 64, 'Claim token should be 64 hex chars');
    assertEqual(tokenHash, hashToken(token), 'Claim token hash should match raw token');
  });
});

describe('Claim Tokens', () => {
  test('classifyClaimTokenRecord returns invalid for missing record', () => {
    assertEqual(classifyClaimTokenRecord(null), 'invalid');
  });

  test('classifyClaimTokenRecord returns active for fresh record', () => {
    const status = classifyClaimTokenRecord({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
      superseded_at: null,
      owner_verified: false
    });
    assertEqual(status, 'active');
  });

  test('classifyClaimTokenRecord returns expired for timed out record', () => {
    const status = classifyClaimTokenRecord({
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      used_at: null,
      superseded_at: null,
      owner_verified: false
    });
    assertEqual(status, 'expired');
  });

  test('classifyClaimTokenRecord returns superseded for replaced record', () => {
    const status = classifyClaimTokenRecord({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: null,
      superseded_at: new Date().toISOString(),
      owner_verified: false
    });
    assertEqual(status, 'superseded');
  });

  test('classifyClaimTokenRecord returns already_claimed for used verified record', () => {
    const status = classifyClaimTokenRecord({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: new Date().toISOString(),
      superseded_at: null,
      owner_verified: true
    });
    assertEqual(status, 'already_claimed');
  });

  test('classifyClaimTokenRecord returns invalid for used unverified record', () => {
    const status = classifyClaimTokenRecord({
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      used_at: new Date().toISOString(),
      superseded_at: null,
      owner_verified: false
    });
    assertEqual(status, 'invalid');
  });
});

describe('Webhook Utils', () => {
  test('normalizeWebhookEvents deduplicates and validates supported events', () => {
    const events = normalizeWebhookEvents(['mention', 'reply', 'mention']);
    assertEqual(events.length, 2);
    assert(events.includes('mention'), 'mention should be present');
    assert(events.includes('reply'), 'reply should be present');
  });

  test('validateWebhookUrl accepts public https URLs in production mode', () => {
    const url = validateWebhookUrl('https://agent.example/webhook', { production: true });
    assertEqual(url, 'https://agent.example/webhook');
  });

  test('validateWebhookUrl rejects localhost in production mode', () => {
    let threw = false;
    try {
      validateWebhookUrl('https://localhost:3000/webhook', { production: true });
    } catch (error) {
      threw = true;
      assert(error.message.includes('public hostname'), 'Should reject non-public hostnames');
    }
    assert(threw, 'Expected localhost URL validation to throw');
  });

  test('buildWebhookSignature is deterministic', () => {
    const signature = buildWebhookSignature('secret', '123', '{"ok":true}');
    const signatureAgain = buildWebhookSignature('secret', '123', '{"ok":true}');
    assertEqual(signature, signatureAgain);
  });

  test('getWebhookRetryDelayMs caps at 60 minutes', () => {
    assertEqual(getWebhookRetryDelayMs(1), 60_000);
    assertEqual(getWebhookRetryDelayMs(4), 3_600_000);
    assertEqual(getWebhookRetryDelayMs(9), 3_600_000);
  });

  test('getWebhookTargetKind distinguishes same deployment from external urls', () => {
    assertEqual(getWebhookTargetKind(`${config.app.baseUrl}/api/v1/health`), 'same_deployment');
    assertEqual(getWebhookTargetKind('https://agent.example/webhook'), 'external');
  });
});

describe('Anchor Utils', () => {
  test('buildAnchorIdempotencyKey is deterministic and bounded', () => {
    const first = buildAnchorIdempotencyKey('post', 42, '0xabc123');
    const second = buildAnchorIdempotencyKey('post', 42, '0xabc123');
    const changed = buildAnchorIdempotencyKey('post', 43, '0xabc123');

    assertEqual(first, second);
    assert(first.startsWith('anchor_'), 'Key should use stable anchor prefix');
    assertEqual(first.length, 47, 'Key should remain short enough for provider idempotency limits');
    assert(first !== changed, 'Different content should produce a different idempotency key');
  });

  test('classifyAnchorFailure marks insufficient funds as retryable', () => {
    const result = classifyAnchorFailure(new Error('the asset amount owned by the wallet is insufficient for the transaction.'));
    assertEqual(result.code, 'insufficient_funds');
    assertEqual(result.retryable, true);
  });

  test('classifyAnchorFailure marks missing config as blocked', () => {
    const result = classifyAnchorFailure(new Error('ARC_CONTENT_REGISTRY_ADDRESS is not configured'));
    assertEqual(result.code, 'blocked_config');
    assertEqual(result.retryable, false);
  });

  test('classifyAnchorFailure marks connection resets as retryable network errors', () => {
    const result = classifyAnchorFailure(new Error('socket hang up | ECONNRESET'));
    assertEqual(result.code, 'network_reset');
    assertEqual(result.retryable, true);
  });

  test('classifyAnchorFailure marks already anchored as reconciliable', () => {
    const result = classifyAnchorFailure(new Error('execution reverted: already anchored'));
    assertEqual(result.code, 'already_anchored');
    assertEqual(result.retryable, false);
  });

  test('getAnchorRetryDelayMs caps at 60 minutes', () => {
    assertEqual(getAnchorRetryDelayMs(1), 60_000);
    assertEqual(getAnchorRetryDelayMs(4), 3_600_000);
    assertEqual(getAnchorRetryDelayMs(99), 3_600_000);
  });
});

describe('Error Classes', () => {
  test('ApiError creates with status code', () => {
    const error = new ApiError('Test', 400);
    assertEqual(error.statusCode, 400);
    assertEqual(error.message, 'Test');
  });

  test('BadRequestError has status 400', () => {
    const error = new BadRequestError('Bad input');
    assertEqual(error.statusCode, 400);
  });

  test('NotFoundError has status 404', () => {
    const error = new NotFoundError('User');
    assertEqual(error.statusCode, 404);
    assert(error.message.includes('not found'));
  });

  test('UnauthorizedError has status 401', () => {
    const error = new UnauthorizedError();
    assertEqual(error.statusCode, 401);
  });

  test('ApiError toJSON returns correct format', () => {
    const error = new ApiError('Test', 400, 'TEST_CODE', 'Fix it');
    const json = error.toJSON();
    assertEqual(json.success, false);
    assertEqual(json.error, 'Test');
    assertEqual(json.code, 'TEST_CODE');
    assertEqual(json.hint, 'Fix it');
  });
});

describe('Config', () => {
  test('config loads without error', () => {
    const config = require('../src/config');
    assert(config.port, 'Should have port');
    assert(config.auth.tokenPrefix, 'Should have token prefix');
  });
});

// Run
runTests();
