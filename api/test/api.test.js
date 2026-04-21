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
  hashToken,
  generateIdentityToken,
  verifyIdentityToken
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
  generateAnchorLocalId,
  resolveChainAnchorId,
  isAnchorLocalIdCollision,
  classifyAnchorFailure,
  getAnchorRetryDelayMs
} = require('../src/utils/anchors');
const {
  encryptStoredSecret,
  decryptStoredSecret
} = require('../src/utils/crypto');
const {
  computeVerificationTier,
  agentCanPost,
  requiresContentVerification
} = require('../src/utils/verification');
const { serializeAgent } = require('../src/utils/serializers');
const publicDocs = require('../src/utils/publicDocs');
const DmService = require('../src/services/DmService');
const ArcIdentityService = require('../src/services/ArcIdentityService');
const AgentService = require('../src/services/AgentService');
const NotificationService = require('../src/services/NotificationService');
const BackgroundWorkService = require('../src/services/BackgroundWorkService');
const AgentActionService = require('../src/services/AgentActionService');
const PaymentService = require('../src/services/PaymentService');
const agentRoutes = require('../src/routes/agents');
const apiRoutes = require('../src/routes');
const homeRoutes = require('../src/routes/home');
const postsRoutes = require('../src/routes/posts');
const commentsRoutes = require('../src/routes/comments');
const authRoutes = require('../src/routes/auth');
const anchorRoutes = require('../src/routes/anchors');
const mediaRoutes = require('../src/routes/media');
const moderationRoutes = require('../src/routes/moderation');
const reportRoutes = require('../src/routes/reports');
const ownerRoutes = require('../src/routes/owner');
const mcpRoutes = require('../src/routes/mcp');
const skillRoutes = require('../src/routes/skills');
const submoltRoutes = require('../src/routes/submolts');
const paymentRoutes = require('../src/routes/payments');
const config = require('../src/config');

const {
  ApiError,
  BadRequestError,
  ConflictError,
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

function createMockRes(onFinish = () => {}) {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      onFinish();
      return this;
    },
    send(payload) {
      this.body = payload;
      this.ended = true;
      onFinish();
      return this;
    },
    end(payload) {
      this.body = payload;
      this.ended = true;
      onFinish();
      return this;
    }
  };
}

function getRouteHandler(router, method, path) {
  const layer = getRouteLayer(router, method, path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function getRouteLayer(router, method, path) {
  const layer = router.stack.find((entry) => entry.route && entry.route.path === path && entry.route.methods?.[method]);
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  return layer;
}

async function invokeRoute(router, method, path, req = {}) {
  const handler = getRouteHandler(router, method, path);
  let settle = null;
  let settled = false;
  const done = new Promise((resolve, reject) => {
    settle = { resolve, reject };
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    settle.resolve();
  };
  const fail = (error) => {
    if (settled) return;
    settled = true;
    settle.reject(error);
  };
  const res = createMockRes(finish);
  const timeout = setTimeout(() => {
    fail(new Error(`Timed out waiting for ${method.toUpperCase()} ${path}`));
  }, 1000);

  try {
    handler(req, res, (error) => {
      if (error) fail(error);
      else finish();
    });
  } catch (error) {
    fail(error);
  }

  await done;
  clearTimeout(timeout);

  return res;
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

describe('Verification Utils', () => {
  test('computeVerificationTier returns established after 24 hours', () => {
    const tier = computeVerificationTier({
      created_at: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      owner_verified: false,
      owner_email: null
    });
    assertEqual(tier, 'established');
  });

  test('agentCanPost returns false for a healthy new agent', () => {
    const allowed = agentCanPost({
      created_at: new Date().toISOString(),
      status: 'active',
      suspended_until: null
    });
    assertEqual(allowed, false);
  });

  test('agentCanPost returns false when agent is suspended', () => {
    const allowed = agentCanPost({
      created_at: new Date().toISOString(),
      status: 'active',
      suspended_until: new Date(Date.now() + 60_000).toISOString()
    });
    assertEqual(allowed, false);
  });

  test('agentCanPost returns true once an agent is at least 24 hours old', () => {
    const allowed = agentCanPost({
      created_at: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      status: 'active',
      suspended_until: null
    });
    assertEqual(allowed, true);
  });

  test('agentCanPost returns true for owner-linked agents immediately', () => {
    const allowed = agentCanPost({
      created_at: new Date().toISOString(),
      status: 'active',
      owner_email: 'owner@example.com'
    });
    assertEqual(allowed, true);
  });

  test('requiresContentVerification returns true for untrusted agents that can post', () => {
    const required = requiresContentVerification({
      created_at: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      status: 'active',
      owner_verified: false,
      owner_email: null,
      karma: 0
    });
    assertEqual(required, true);
  });

  test('requiresContentVerification returns false for verified owners', () => {
    const required = requiresContentVerification({
      created_at: new Date().toISOString(),
      status: 'active',
      owner_verified: true
    });
    assertEqual(required, false);
  });
});

describe('Identity Tokens', () => {
  test('generateIdentityToken includes normalized audience', () => {
    const token = generateIdentityToken('42', config.security.sessionSecret, 'My-App');
    const decoded = verifyIdentityToken(token, config.security.sessionSecret);
    assert(decoded, 'Token should verify');
    assertEqual(decoded.agentId, '42');
    assertEqual(decoded.audience, 'my-app');
  });

  test('verifyIdentityToken rejects tampered payloads', () => {
    const token = generateIdentityToken('42', config.security.sessionSecret, 'app');
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const tampered = Buffer.from(decoded.replace('42:', '43:'), 'utf8').toString('base64url');
    assertEqual(verifyIdentityToken(tampered, config.security.sessionSecret), null);
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

describe('Crypto Utils', () => {
  test('encryptStoredSecret round-trips plaintext', () => {
    const payload = encryptStoredSecret('arcbook_secret_token');
    assertEqual(decryptStoredSecret(payload), 'arcbook_secret_token');
  });
});

describe('Anchor Utils', () => {
  test('generateAnchorLocalId returns non-zero decimal strings', () => {
    const id = generateAnchorLocalId();
    assert(/^[1-9][0-9]*$/.test(id), 'Anchor local id should be a non-zero decimal string');
    assert(id.length <= 39, 'Anchor local id should fit within 128-bit decimal length');
  });

  test('resolveChainAnchorId prefers stored on-chain ids and falls back to db ids', () => {
    assertEqual(resolveChainAnchorId('340282366920938463463374607431768211455', 42), '340282366920938463463374607431768211455');
    assertEqual(resolveChainAnchorId(null, 42), '42');
  });

  test('isAnchorLocalIdCollision detects partial unique index violations', () => {
    assertEqual(
      isAnchorLocalIdCollision({ code: '23505', constraint: 'idx_posts_anchor_local_id' }),
      true
    );
    assertEqual(
      isAnchorLocalIdCollision({ code: '23505', message: 'duplicate key value violates unique constraint "idx_comments_anchor_local_id"' }),
      true
    );
    assertEqual(isAnchorLocalIdCollision({ code: '23505', constraint: 'agents_name_key' }), false);
  });

  test('buildAnchorIdempotencyKey is deterministic and bounded', () => {
    const first = buildAnchorIdempotencyKey('post', 42, '0xabc123');
    const second = buildAnchorIdempotencyKey('post', 42, '0xabc123');
    const changed = buildAnchorIdempotencyKey('post', 43, '0xabc123');

    assertEqual(first, second);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(first), 'Key should be a UUID v4 string');
    assertEqual(first.length, 36, 'Key should match UUID length');
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

describe('Public Docs', () => {
  test('skill json exposes canonical urls and version', () => {
    const payload = publicDocs.getSkillJson();
    assertEqual(payload.version, '2.1.0');
    assertEqual(payload.homepage, 'https://arcbook.xyz');
    assertEqual(payload.api_base, 'https://api.arcbook.xyz/api/v1');
    assertEqual(payload.skill_url, 'https://arcbook.xyz/skill.md');
    assertEqual(payload.guideUrl, payload.skillUrl);
    assertEqual(payload.homeUrl, 'https://api.arcbook.xyz/api/v1/home');
    assertEqual(payload.auth?.header, 'Authorization');
    assert(Array.isArray(payload.headers?.appKey), 'skill json should preserve legacy header aliases');
    assert(Array.isArray(payload.capabilities), 'skill json should preserve legacy capabilities');
  });

  test('auth doc params fall back when endpoint is invalid', () => {
    const params = publicDocs.resolveAuthDocParams({
      app: 'Example',
      endpoint: 'not-a-valid-url',
      header: 'X-Custom-Identity'
    });

    assertEqual(params.appName, 'Example');
    assertEqual(params.endpoint, 'https://your-api.com/action');
    assertEqual(params.audience, 'your-api.com');
    assertEqual(params.headerName, 'X-Custom-Identity');
  });

  test('renderAuthMd uses endpoint hostname as identity token audience', () => {
    const markdown = publicDocs.renderAuthMd({
      app: 'Demo',
      endpoint: 'https://demo.example.com/action'
    });

    assert(markdown.includes('"audience": "demo.example.com"'), 'Auth doc should use endpoint hostname as audience');
    assert(markdown.includes('curl -X POST https://demo.example.com/action'), 'Auth doc should render the provided endpoint');
  });
});

describe('Arc Identity Helpers', () => {
  test('buildArcIdentityBlock returns api-facing arc identity payload', () => {
    const arcIdentity = agentRoutes.buildArcIdentityBlock({
      token_id: '123',
      wallet_address: '0xabc',
      metadata_uri: 'https://api.arcbook.xyz/content/agents/alice/identity',
      registration_status: 'confirmed',
      registration_tx_hash: '0xtx',
      chain_id: 5042002
    });

    assertEqual(arcIdentity.agent_id, '123');
    assertEqual(arcIdentity.wallet_address, '0xabc');
    assertEqual(arcIdentity.registration_status, 'confirmed');
    assertEqual(arcIdentity.explorer_url, 'https://testnet.arcscan.app/tx/0xtx');
  });

  test('fetchTokenIdFromChain returns null when txHash or owner is missing', async () => {
    assertEqual(await ArcIdentityService.fetchTokenIdFromChain(null, '0xabc'), null);
    assertEqual(await ArcIdentityService.fetchTokenIdFromChain('0xtx', null), null);
  });

  test('fetchTokenIdFromChain returns latest token id from transfer logs', async () => {
    const originalFactory = ArcIdentityService.createArcPublicClient;
    ArcIdentityService.createArcPublicClient = () => ({
      getTransactionReceipt: async () => ({ blockNumber: 42n }),
      getLogs: async () => ([
        { args: { tokenId: 7n } },
        { args: { tokenId: 9n } }
      ])
    });

    try {
      const tokenId = await ArcIdentityService.fetchTokenIdFromChain('0xtx', '0xabc');
      assertEqual(tokenId, '9');
    } finally {
      ArcIdentityService.createArcPublicClient = originalFactory;
    }
  });

  test('fetchTokenIdFromChain returns null when transfer log lookup fails', async () => {
    const originalFactory = ArcIdentityService.createArcPublicClient;
    ArcIdentityService.createArcPublicClient = () => ({
      getTransactionReceipt: async () => {
        throw new Error('timeout');
      }
    });

    try {
      const tokenId = await ArcIdentityService.fetchTokenIdFromChain('0xtx', '0xabc');
      assertEqual(tokenId, null);
    } finally {
      ArcIdentityService.createArcPublicClient = originalFactory;
    }
  });

  test('backfillTokenId updates confirmed rows missing token ids', async () => {
    const originalFetch = ArcIdentityService.fetchTokenIdFromChain;
    const originalUpdate = ArcIdentityService.update;

    ArcIdentityService.fetchTokenIdFromChain = async () => '77';
    ArcIdentityService.update = async (_agentId, updates) => ({
      registration_status: 'confirmed',
      registration_tx_hash: '0xtx',
      wallet_address: '0xabc',
      token_id: updates.token_id,
      last_error: updates.last_error
    });

    try {
      const updated = await ArcIdentityService.backfillTokenId('agent-1', {
        registration_status: 'confirmed',
        registration_tx_hash: '0xtx',
        wallet_address: '0xabc',
        token_id: null
      });
      assertEqual(updated.token_id, '77');
    } finally {
      ArcIdentityService.fetchTokenIdFromChain = originalFetch;
      ArcIdentityService.update = originalUpdate;
    }
  });
});

describe('DM Helpers', () => {
  test('normalizeOwnerHandle accepts raw and prefixed handles', () => {
    assertEqual(DmService.normalizeOwnerHandle('@Alice'), 'alice');
    assertEqual(DmService.normalizeOwnerHandle('Bob'), 'bob');
  });

  test('updateRequestStatus uses typed approval flags instead of reusing the status param', async () => {
    const db = require('../src/config/database');
    const originalQueryOne = db.queryOne;
    let capturedParams = null;

    db.queryOne = async (_sql, params) => {
      capturedParams = params;
      return { id: 'conv-1', status: 'approved' };
    };

    delete require.cache[require.resolve('../src/services/DmService')];
    const DmService = require('../src/services/DmService');

    try {
      const result = await DmService.updateRequestStatus('agent-2', 'conv-1', 'approve');

      assertEqual(result.success, true);
      assertEqual(result.status, 'approved');
      assert(capturedParams, 'Expected query params to be captured');
      assertEqual(capturedParams.length, 6, 'Expected boolean guard params for DM status update');
      assertEqual(capturedParams[2], 'approved');
      assertEqual(capturedParams[3], true);
      assertEqual(capturedParams[4], false);
      assertEqual(capturedParams[5], false);
    } finally {
      db.queryOne = originalQueryOne;
      delete require.cache[require.resolve('../src/services/DmService')];
    }
  });
});

describe('Payment Helpers', () => {
  test('normalizeTransferError maps insufficient funds to conflict', () => {
    const error = PaymentService.normalizeTransferError(
      new Error('the asset amount owned by the wallet is insufficient for the transaction.'),
      '1.0'
    );

    assert(error instanceof ConflictError, 'Expected insufficient funds to become ConflictError');
    assertEqual(error.code, 'INSUFFICIENT_FUNDS');
  });

  test('normalizeTransferError maps authorization failures to bad request', () => {
    const error = PaymentService.normalizeTransferError(
      new Error('execution reverted: Not authorized'),
      '1.0'
    );

    assert(error instanceof BadRequestError, 'Expected unauthorized wallet failures to become BadRequestError');
    assertEqual(error.code, 'PAYMENT_NOT_AUTHORIZED');
  });

  test('transfer rejects when requested amount exceeds available balance', async () => {
    const originalGetById = AgentService.getById;
    const originalEnsureWallet = require('../src/services/WalletService').ensureWallet;
    const originalGetBalance = PaymentService.getBalance;

    AgentService.getById = async () => ({ id: 'agent-1', name: 'alice' });
    require('../src/services/WalletService').ensureWallet = async () => ({
      circle_wallet_id: 'wallet-1',
      wallet_address: '0x1111111111111111111111111111111111111111'
    });
    PaymentService.getBalance = async () => ({
      usdc: '0.250000',
      walletAddress: '0x1111111111111111111111111111111111111111',
      circleWalletId: 'wallet-1',
      hasWallet: true
    });

    try {
      let threw = false;
      try {
        await PaymentService.transfer({
          fromAgentId: 'agent-1',
          toAddress: '0x2222222222222222222222222222222222222222',
          amountUsdc: '1.0'
        });
      } catch (error) {
        threw = true;
        assert(error instanceof ConflictError, 'Expected insufficient balance to reject with ConflictError');
        assertEqual(error.code, 'INSUFFICIENT_FUNDS');
      }

      assert(threw, 'Expected transfer to reject before hitting Circle when balance is too low');
    } finally {
      AgentService.getById = originalGetById;
      require('../src/services/WalletService').ensureWallet = originalEnsureWallet;
      PaymentService.getBalance = originalGetBalance;
    }
  });
});

describe('Route Contracts', () => {
  test('listed public API endpoints are mounted on the expected routers', () => {
    const specs = [
      { router: agentRoutes, method: 'post', path: '/register' },
      { router: agentRoutes, method: 'get', path: '/me', middleware: 'requireAuth' },
      { router: homeRoutes, method: 'get', path: '/', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'post', path: '/', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'get', path: '/', middleware: 'optionalAuth' },
      { router: postsRoutes, method: 'post', path: '/:id/comments', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'post', path: '/:id/vote', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/:handle/follow', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'delete', path: '/:handle/follow', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/me/heartbeat', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/me/mentions', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/:handle/capabilities.md', middleware: 'optionalAuth' },
      { router: agentRoutes, method: 'post', path: '/me/identity-token', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/verify-identity' },
      { router: agentRoutes, method: 'get', path: '/:handle/network', middleware: 'optionalAuth' },
      { router: agentRoutes, method: 'post', path: '/me/x-verify/start', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/me/x-verify/confirm', middleware: 'requireAuth' },
      { router: anchorRoutes, method: 'get', path: '/:contentType/:id' },
      { router: agentRoutes, method: 'post', path: '/me/arc/identity/register', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/me/arc/identity', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'patch', path: '/me/arc/identity', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'patch', path: '/:id', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'delete', path: '/:id', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'post', path: '/:id/upvote', middleware: 'requireAuth' },
      { router: postsRoutes, method: 'post', path: '/:id/downvote', middleware: 'requireAuth' },
      { router: commentsRoutes, method: 'patch', path: '/:id', middleware: 'requireAuth' },
      { router: commentsRoutes, method: 'delete', path: '/:id', middleware: 'requireAuth' },
      { router: commentsRoutes, method: 'post', path: '/:id/upvote', middleware: 'requireAuth' },
      { router: commentsRoutes, method: 'post', path: '/:id/downvote', middleware: 'requireAuth' },
      { router: require('../src/routes/verify'), method: 'post', path: '/', middleware: 'requireAuth' },
      { router: mediaRoutes, method: 'post', path: '/images', middleware: 'requireAuth' },
      { router: submoltRoutes, method: 'post', path: '/:slug/moderators', middleware: 'requireAuth' },
      { router: submoltRoutes, method: 'delete', path: '/:slug/moderators/:agentName', middleware: 'requireAuth' },
      { router: submoltRoutes, method: 'get', path: '/:slug/moderators', middleware: 'optionalAuth' },
      { router: moderationRoutes, method: 'get', path: '/queue', middleware: 'requireAuth' },
      { router: moderationRoutes, method: 'post', path: '/actions', middleware: 'requireAuth' },
      { router: moderationRoutes, method: 'post', path: '/reports/:id/resolve', middleware: 'requireAuth' },
      { router: moderationRoutes, method: 'post', path: '/reports/:id/dismiss', middleware: 'requireAuth' },
      { router: reportRoutes, method: 'post', path: '/', middleware: 'requireAuth' },
      { router: paymentRoutes, method: 'get', path: '/wallet', middleware: 'requireAuth' },
      { router: paymentRoutes, method: 'get', path: '/balance', middleware: 'requireAuth' },
      { router: paymentRoutes, method: 'post', path: '/transfer', middleware: 'requireAuth' },
      { router: paymentRoutes, method: 'get', path: '/history', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/:handle/reputation', middleware: 'optionalAuth' },
      { router: agentRoutes, method: 'post', path: '/:handle/reputation/feedback', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/me/validation/request', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'post', path: '/validation/respond', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/validation/:hash/status', middleware: 'optionalAuth' },
      { router: skillRoutes, method: 'get', path: '/', middleware: 'optionalAuth' },
      { router: skillRoutes, method: 'post', path: '/', middleware: 'requireAuth' },
      { router: agentRoutes, method: 'get', path: '/:handle/skills', middleware: 'optionalAuth' },
      { router: agentRoutes, method: 'get', path: '/', middleware: undefined },
      { router: ownerRoutes, method: 'get', path: '/developer-apps', middleware: 'requireOwnerAuth' },
      { router: ownerRoutes, method: 'post', path: '/developer-apps', middleware: 'requireOwnerAuth' },
      { router: ownerRoutes, method: 'delete', path: '/developer-apps/:id', middleware: 'requireOwnerAuth' },
      { router: authRoutes, method: 'post', path: '/owner/magic-link' },
      { router: authRoutes, method: 'get', path: '/owner/verify' },
      { router: authRoutes, method: 'post', path: '/owner/confirm' },
      { router: ownerRoutes, method: 'get', path: '/me', middleware: 'requireOwnerAuth' },
      { router: ownerRoutes, method: 'post', path: '/agents/:id/refresh-api-key', middleware: 'requireOwnerAuth' },
      { router: ownerRoutes, method: 'post', path: '/anchors/:contentType/:id/retry', middleware: 'requireOwnerAuth' },
      { router: ownerRoutes, method: 'delete', path: '/account', middleware: 'requireOwnerAuth' }
    ];

    for (const spec of specs) {
      const layer = getRouteLayer(spec.router, spec.method, spec.path);
      assert(layer, `Expected route ${spec.method.toUpperCase()} ${spec.path}`);
      if (spec.middleware) {
        const names = layer.route.stack.map((entry) => entry.handle.name);
        assert(
          names.includes(spec.middleware),
          `Expected ${spec.method.toUpperCase()} ${spec.path} to include ${spec.middleware}, got ${names.join(', ')}`
        );
      }
    }
  });

  test('capabilities markdown endpoint renders a public manifest', async () => {
    const originalGetByHandle = AgentService.getByHandle;
    AgentService.getByHandle = async () => ({
      id: 'agent-1',
      name: 'alice',
      display_name: 'Alice',
      description: 'Capability manifest smoke',
      karma: 7,
      capabilities: JSON.stringify({
        schema: 'arcbook.capabilities/v1',
        version: '1.0',
        tags: ['search', 'moderation']
      })
    });

    try {
      const res = await invokeRoute(agentRoutes, 'get', '/:handle/capabilities.md', {
        params: { handle: 'alice' },
        agent: null
      });

      assertEqual(res.statusCode, 200);
      assertEqual(res.headers['Content-Type'], 'text/markdown; charset=utf-8');
      assert(String(res.body).includes('# @alice Capabilities'));
      assert(String(res.body).includes('arcbook.capabilities/v1'));
      assert(String(res.body).includes('search'));
    } finally {
      AgentService.getByHandle = originalGetByHandle;
    }
  });
});

describe('Notification Helpers', () => {
  test('notifyMentions waits for notification inserts before emitting mention events', async () => {
    const db = require('../src/config/database');
    const AgentEventService = require('../src/services/AgentEventService');
    const WebhookService = require('../src/services/WebhookService');
    const originalQueryAll = db.queryAll;
    const originalEmitMention = AgentEventService.emitMention;
    const originalEnqueueEvent = WebhookService.enqueueEvent;

    db.queryAll = async () => [{ id: 'agent-2' }];
    let insertResolved = false;
    let emitCalled = false;

    delete require.cache[require.resolve('../src/services/NotificationService')];
    const NotificationService = require('../src/services/NotificationService');
    const originalCreate = NotificationService.create;

    NotificationService.create = async () => new Promise((resolve) => {
      setTimeout(() => {
        insertResolved = true;
        resolve({ id: 'notif-1' });
      }, 10);
    });
    AgentEventService.emitMention = async () => {
      emitCalled = true;
      assertEqual(insertResolved, true, 'Mention events should emit only after notification inserts complete');
    };
    WebhookService.enqueueEvent = async () => ({ queued: true });

    try {
      await NotificationService.notifyMentions('@bob hi', 'agent-1', '/post/17', {
        postId: '17',
        sourceType: 'post',
        sourceId: '17'
      });

      assertEqual(emitCalled, true, 'Expected mention event emission');
    } finally {
      NotificationService.create = originalCreate;
      AgentEventService.emitMention = originalEmitMention;
      WebhookService.enqueueEvent = originalEnqueueEvent;
      db.queryAll = originalQueryAll;
      delete require.cache[require.resolve('../src/services/NotificationService')];
    }
  });

  test('notifyMentions surfaces notification insert failures', async () => {
    const db = require('../src/config/database');
    const AgentEventService = require('../src/services/AgentEventService');
    const WebhookService = require('../src/services/WebhookService');
    const originalQueryAll = db.queryAll;
    const originalEmitMention = AgentEventService.emitMention;
    const originalEnqueueEvent = WebhookService.enqueueEvent;

    db.queryAll = async () => [{ id: 'agent-2' }];
    let emitCalled = false;

    delete require.cache[require.resolve('../src/services/NotificationService')];
    const NotificationService = require('../src/services/NotificationService');
    const originalCreate = NotificationService.create;

    NotificationService.create = async () => {
      throw new Error('insert failed');
    };
    AgentEventService.emitMention = async () => {
      emitCalled = true;
    };
    WebhookService.enqueueEvent = async () => ({ queued: true });

    try {
      let threw = false;
      try {
        await NotificationService.notifyMentions('@bob hi', 'agent-1', '/post/17');
      } catch (error) {
        threw = true;
        assert(error.message.includes('insert failed'), 'Expected insert failure to surface');
      }

      assert(threw, 'Expected notifyMentions to reject on notification insert failure');
      assertEqual(emitCalled, false, 'Mention events should not emit after a failed notification insert');
    } finally {
      NotificationService.create = originalCreate;
      AgentEventService.emitMention = originalEmitMention;
      WebhookService.enqueueEvent = originalEnqueueEvent;
      db.queryAll = originalQueryAll;
      delete require.cache[require.resolve('../src/services/NotificationService')];
    }
  });
});

describe('Serialization Utils', () => {
  test('serializeAgent exposes ownerEmail and posting gate state', () => {
    const serialized = serializeAgent({
      id: 'agent-1',
      name: 'alice',
      display_name: 'Alice',
      owner_email: 'owner@example.com',
      owner_verified: false,
      created_at: new Date().toISOString(),
      status: 'active'
    });

    assertEqual(serialized.ownerEmail, 'owner@example.com');
    assertEqual(serialized.canPost, true);
  });
});

describe('Agent Action Guards', () => {
  test('sendDm rejects restricted agents before dispatching', async () => {
    const originalSendMessage = DmService.sendMessage;
    let called = false;
    DmService.sendMessage = async () => {
      called = true;
    };

    try {
      let threw = false;
      try {
        await AgentActionService.sendDm({
          agent: { id: 'agent-1', status: 'active', createdAt: new Date().toISOString() },
          conversationId: 'conv-1',
          message: 'hello'
        });
      } catch (error) {
        threw = true;
        assert(error.message.includes('cannot post right now'), 'Expected posting guard error');
      }

      assert(threw, 'Expected sendDm to reject restricted agents');
      assertEqual(called, false, 'DM service should not run for restricted agents');
    } finally {
      DmService.sendMessage = originalSendMessage;
    }
  });

  test('upvotePost rejects restricted agents before hitting vote service', async () => {
    const VoteService = require('../src/services/VoteService');
    const originalUpvotePost = VoteService.upvotePost;
    let called = false;
    VoteService.upvotePost = async () => {
      called = true;
    };

    try {
      let threw = false;
      try {
        await AgentActionService.upvotePost({
          agent: { id: 'agent-1', status: 'active', createdAt: new Date().toISOString() },
          postId: 'post-1'
        });
      } catch (error) {
        threw = true;
        assert(error.message.includes('cannot post right now'), 'Expected posting guard error');
      }

      assert(threw, 'Expected upvotePost to reject restricted agents');
      assertEqual(called, false, 'Vote service should not run for restricted agents');
    } finally {
      VoteService.upvotePost = originalUpvotePost;
    }
  });
});

describe('Comment Threads', () => {
  test('threaded comment view can be built without mutating the flat list', () => {
    delete require.cache[require.resolve('../src/services/CommentService')];
    const CommentService = require('../src/services/CommentService');

    const flatComments = [
      { id: '36', parentId: null, replies: [] },
      { id: '37', parentId: '36', replies: [] },
      { id: '38', parentId: '37', replies: [] }
    ];

    const threaded = CommentService.buildTree(CommentService.cloneComments(flatComments));

    assertEqual(flatComments.length, 3, 'Flat list should preserve all comments');
    assertEqual(flatComments[0].replies.length, 0, 'Flat list should remain unnested');
    assertEqual(threaded.length, 1, 'Only one root comment should remain at top level');
    assertEqual(threaded[0].id, '36');
    assertEqual(threaded[0].replies.length, 1, 'First reply should be nested under its parent');
    assertEqual(threaded[0].replies[0].id, '37');
    assertEqual(threaded[0].replies[0].replies[0].id, '38');
  });
});

describe('Listing Filters', () => {
  test('post feed query excludes removed posts defensively', async () => {
    const db = require('../src/config/database');
    const originalQueryAll = db.queryAll;
    let capturedSql = null;

    db.queryAll = async (sql) => {
      capturedSql = sql;
      return [];
    };

    delete require.cache[require.resolve('../src/services/PostService')];
    const PostService = require('../src/services/PostService');

    try {
      await PostService.getFeed({ sort: 'new', limit: 10 });
      assert(capturedSql && capturedSql.includes('COALESCE(p.is_removed, false) = false'), 'Feed query should exclude removed posts');
    } finally {
      db.queryAll = originalQueryAll;
      delete require.cache[require.resolve('../src/services/PostService')];
    }
  });

  test('home activity query excludes removed posts', async () => {
    const db = require('../src/config/database');
    const PostService = require('../src/services/PostService');
    const originalQueryOne = db.queryOne;
    const originalQueryAll = db.queryAll;
    const originalGetFeed = PostService.getFeed;
    let activitySql = null;

    db.queryOne = async (sql) => {
      if (sql.includes('FROM agents a')) {
        return { id: 'agent-1', name: 'alice', display_name: 'Alice', following_count: 0, karma: 0, status: 'active', suspended_until: null, created_at: new Date().toISOString() };
      }
      if (sql.includes('FROM notifications WHERE recipient_id')) {
        return { count: 0 };
      }
      if (sql.includes('FROM dm_conversations')) {
        return { pending_request_count: 0, unread_message_count: 0 };
      }
      if (sql.includes("FROM posts p") && sql.includes("h.slug = 'announcements'")) {
        return null;
      }
      return null;
    };

    db.queryAll = async (sql) => {
      if (sql.includes('FROM notifications n')) {
        activitySql = sql;
        return [];
      }
      return [];
    };

    PostService.getFeed = async () => ({ posts: [] });

    delete require.cache[require.resolve('../src/services/AgentService')];
    const AgentService = require('../src/services/AgentService');

    try {
      await AgentService.getHomeData('agent-1');
      assert(activitySql && activitySql.includes('AND p.is_removed = false'), 'Home activity query should exclude removed posts');
    } finally {
      db.queryOne = originalQueryOne;
      db.queryAll = originalQueryAll;
      PostService.getFeed = originalGetFeed;
      delete require.cache[require.resolve('../src/services/AgentService')];
    }
  });

  test('profile recent posts query excludes removed posts', async () => {
    const db = require('../src/config/database');
    const originalQueryAll = db.queryAll;
    let capturedSql = null;

    db.queryAll = async (sql) => {
      capturedSql = sql;
      return [];
    };

    delete require.cache[require.resolve('../src/services/AgentService')];
    const AgentService = require('../src/services/AgentService');

    try {
      await AgentService.getRecentPosts('agent-1');
      assert(capturedSql && capturedSql.includes('COALESCE(p.is_removed, false) = false'), 'Profile posts query should exclude removed posts');
    } finally {
      db.queryAll = originalQueryAll;
      delete require.cache[require.resolve('../src/services/AgentService')];
    }
  });

  test('comment listing query excludes removed comments', async () => {
    const db = require('../src/config/database');
    const originalQueryAll = db.queryAll;
    let capturedSql = null;

    db.queryAll = async (sql) => {
      capturedSql = sql;
      return [];
    };

    delete require.cache[require.resolve('../src/services/CommentService')];
    const CommentService = require('../src/services/CommentService');

    try {
      await CommentService.getByPost('17', { sort: 'new' });
      assert(capturedSql && capturedSql.includes('COALESCE(c.is_removed, false) = false'), 'Comment listing should exclude removed comments');
    } finally {
      db.queryAll = originalQueryAll;
      delete require.cache[require.resolve('../src/services/CommentService')];
    }
  });
});

describe('Hard Deletes', () => {
  test('post deletion removes the row and related artifacts', async () => {
    const db = require('../src/config/database');
    const cache = require('../src/utils/cache');
    const originalQueryOne = db.queryOne;
    const originalTransaction = db.transaction;
    const originalCacheDel = cache.cacheDel;
    const executedSql = [];

    db.queryOne = async () => ({
      id: 27,
      author_id: 'agent-1',
      hub_id: 9,
      author_name: 'alice'
    });

    db.transaction = async (callback) => callback({
      query: async (sql) => {
        executedSql.push(sql);
        if (sql.includes('SELECT id::text AS id') && sql.includes('FROM comments')) {
          return { rows: [{ id: '36' }, { id: '37' }], rowCount: 2 };
        }
        if (sql.includes('DELETE FROM posts')) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    });

    cache.cacheDel = async () => {};

    delete require.cache[require.resolve('../src/services/PostService')];
    const PostService = require('../src/services/PostService');

    try {
      await PostService.deleteByAuthor(27, 'agent-1');
      assert(executedSql.some((sql) => sql.includes('DELETE FROM comments')), 'Post delete should remove child comments');
      assert(executedSql.some((sql) => sql.includes('DELETE FROM posts')), 'Post delete should remove the post row');
      assert(executedSql.some((sql) => sql.includes('DELETE FROM semantic_documents')), 'Post delete should clean search documents');
      assert(executedSql.some((sql) => sql.includes('UPDATE hubs')), 'Post delete should decrement hub post_count');
    } finally {
      db.queryOne = originalQueryOne;
      db.transaction = originalTransaction;
      cache.cacheDel = originalCacheDel;
      delete require.cache[require.resolve('../src/services/PostService')];
    }
  });

  test('comment deletion removes the full reply subtree and fixes post counts', async () => {
    const db = require('../src/config/database');
    const cache = require('../src/utils/cache');
    const originalQueryOne = db.queryOne;
    const originalTransaction = db.transaction;
    const originalCacheDel = cache.cacheDel;
    const executedSql = [];

    db.queryOne = async () => ({
      id: 36,
      author_id: 'agent-1',
      post_id: 17,
      author_name: 'alice'
    });

    db.transaction = async (callback) => callback({
      query: async (sql) => {
        executedSql.push(sql);
        if (sql.includes('WITH RECURSIVE comment_tree')) {
          return { rows: [{ id: '36', post_id: 17 }, { id: '37', post_id: 17 }], rowCount: 2 };
        }
        return { rows: [], rowCount: 1 };
      }
    });

    cache.cacheDel = async () => {};

    delete require.cache[require.resolve('../src/services/CommentService')];
    const CommentService = require('../src/services/CommentService');

    try {
      await CommentService.deleteByAuthor(36, 'agent-1');
      assert(executedSql.some((sql) => sql.includes('WITH RECURSIVE comment_tree')), 'Comment delete should load the reply subtree');
      assert(executedSql.some((sql) => sql.includes('DELETE FROM comments')), 'Comment delete should remove subtree rows');
      assert(executedSql.some((sql) => sql.includes('UPDATE posts')), 'Comment delete should decrement post comment_count');
    } finally {
      db.queryOne = originalQueryOne;
      db.transaction = originalTransaction;
      cache.cacheDel = originalCacheDel;
      delete require.cache[require.resolve('../src/services/CommentService')];
    }
  });
});

describe('Reply Guards', () => {
  test('reply parent lookup rejects removed comments', async () => {
    const db = require('../src/config/database');
    const originalQueryOne = db.queryOne;
    const originalQuery = db.query;
    const originalTransaction = db.transaction;
    const PostService = require('../src/services/PostService');
    const originalFindById = PostService.findById;
    let parentLookupSql = null;

    db.queryOne = async (sql) => {
      if (sql.includes('FROM posts p')) {
        return { is_locked: false, hub_id: 1 };
      }
      if (sql.includes('FROM hub_bans')) {
        return null;
      }
      if (sql.includes('FROM comments') && sql.includes('post_id = $2')) {
        parentLookupSql = sql;
        return null;
      }
      if (sql.includes('COUNT(*) AS cnt')) {
        return { cnt: 0 };
      }
      return null;
    };

    db.query = async () => ({ rows: [], rowCount: 0 });
    db.transaction = async () => {
      throw new Error('transaction should not run when parent comment is removed');
    };
    PostService.findById = async () => ({ id: '17', author_id: 'agent-2', author_name: 'sunshine' });

    delete require.cache[require.resolve('../src/services/CommentService')];
    const CommentService = require('../src/services/CommentService');

    try {
      let threw = false;
      try {
        await CommentService.create({
          postId: '17',
          authorId: 'agent-1',
          content: 'reply',
          parentId: '36',
          author: {}
        });
      } catch (error) {
        threw = true;
        assert(error.message.includes('Parent comment'), 'Removed parent comments should be rejected');
      }

      assert(threw, 'Expected create to reject removed parent comments');
      assert(parentLookupSql && parentLookupSql.includes('COALESCE(is_removed, false) = false'), 'Parent lookup should exclude removed comments');
    } finally {
      db.queryOne = originalQueryOne;
      db.query = originalQuery;
      db.transaction = originalTransaction;
      PostService.findById = originalFindById;
      delete require.cache[require.resolve('../src/services/CommentService')];
    }
  });
});

describe('Route Guards And Delegation', () => {
  test('home route does not mark notifications as read', async () => {
    const AgentService = require('../src/services/AgentService');
    const originalGetHomeData = AgentService.getHomeData;
    const originalMarkAllRead = NotificationService.markAllRead;
    const originalKick = BackgroundWorkService.kick;
    let markAllReadCount = 0;
    let kicked = null;

    AgentService.getHomeData = async () => ({ unreadCount: 2, can_post: false });
    NotificationService.markAllRead = async () => {
      markAllReadCount += 1;
    };
    BackgroundWorkService.kick = (reason) => {
      kicked = reason;
    };

    try {
      delete require.cache[require.resolve('../src/routes/home')];
      const homeRoutes = require('../src/routes/home');
      const res = await invokeRoute(homeRoutes, 'get', '/', {
        agent: { id: 'agent-1' }
      });

      assertEqual(res.statusCode, 200);
      assertEqual(res.body.success, true);
      assertEqual(markAllReadCount, 0, 'Home route should not silently clear notifications');
      assertEqual(kicked, 'home-read');
    } finally {
      AgentService.getHomeData = originalGetHomeData;
      NotificationService.markAllRead = originalMarkAllRead;
      BackgroundWorkService.kick = originalKick;
      delete require.cache[require.resolve('../src/routes/home')];
    }
  });

  test('posts create route delegates to AgentActionService and preserves rate-limit headers', async () => {
    const originalCreatePost = AgentActionService.createPost;
    let capturedArgs = null;

    AgentActionService.createPost = async (args) => {
      capturedArgs = args;
      return {
        post: {
          id: '17',
          title: args.title,
          body: args.body,
          hub_id: 1,
          hub_slug: args.hubSlug,
          hub_display_name: 'General',
          author_id: args.agent.id,
          author_name: args.agent.name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        rateLimit: { remaining: 4, resetAt: new Date(Date.now() + 60_000) }
      };
    };

    try {
      const res = await invokeRoute(postsRoutes, 'post', '/', {
        agent: { id: 'agent-1', name: 'alice' },
        token: 'arcbook_test',
        ip: '127.0.0.1',
        body: { title: 'Hello', content: 'World', hub: 'general' }
      });

      assertEqual(res.statusCode, 201);
      assertEqual(capturedArgs.agent.id, 'agent-1');
      assertEqual(capturedArgs.token, 'arcbook_test');
      assertEqual(capturedArgs.ip, '127.0.0.1');
      assertEqual(capturedArgs.hubSlug, 'general');
      assertEqual(res.headers['X-RateLimit-Remaining'], 4);
      assert(res.headers['X-RateLimit-Reset'], 'Expected rate-limit reset header');
    } finally {
      AgentActionService.createPost = originalCreatePost;
    }
  });

  test('comments create route delegates to AgentActionService and preserves rate-limit headers', async () => {
    const originalCreateComment = AgentActionService.createComment;
    let capturedArgs = null;

    AgentActionService.createComment = async (args) => {
      capturedArgs = args;
      return {
        comment: {
          id: '36',
          post_id: args.postId,
          body: args.content,
          author_id: args.agent.id,
          author_name: args.agent.name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        rateLimit: { remaining: 7, resetAt: new Date(Date.now() + 60_000) }
      };
    };

    try {
      const res = await invokeRoute(commentsRoutes, 'post', '/', {
        agent: { id: 'agent-1', name: 'alice' },
        token: 'arcbook_test',
        ip: '127.0.0.1',
        body: { postId: '17', content: 'reply', parentId: '35' }
      });

      assertEqual(res.statusCode, 201);
      assertEqual(capturedArgs.postId, '17');
      assertEqual(capturedArgs.parentId, '35');
      assertEqual(res.headers['X-RateLimit-Remaining'], 7);
    } finally {
      AgentActionService.createComment = originalCreateComment;
    }
  });

  test('owner arc identity reset returns 403 for another owner agent', async () => {
    const AgentService = require('../src/services/AgentService');
    const originalGetById = AgentService.getById;
    const originalGetByAgentId = ArcIdentityService.getByAgentId;
    let identityLookupCalled = false;

    AgentService.getById = async () => ({ id: 'agent-2', owner_email: 'other@example.com' });
    ArcIdentityService.getByAgentId = async () => {
      identityLookupCalled = true;
      return { registration_status: 'failed' };
    };

    try {
      delete require.cache[require.resolve('../src/routes/owner')];
      const ownerRoutes = require('../src/routes/owner');
      const res = await invokeRoute(ownerRoutes, 'post', '/agents/:id/arc-identity/reset', {
        ownerEmail: 'owner@example.com',
        params: { id: 'agent-2' }
      });

      assertEqual(res.statusCode, 403);
      assertEqual(identityLookupCalled, false, 'Should stop before touching arc identity rows');
    } finally {
      AgentService.getById = originalGetById;
      ArcIdentityService.getByAgentId = originalGetByAgentId;
      delete require.cache[require.resolve('../src/routes/owner')];
    }
  });

  test('owner arc identity retry returns 403 for another owner agent', async () => {
    const AgentService = require('../src/services/AgentService');
    const originalGetById = AgentService.getById;
    const originalGetByAgentId = ArcIdentityService.getByAgentId;
    let identityLookupCalled = false;

    AgentService.getById = async () => ({ id: 'agent-2', owner_email: 'other@example.com' });
    ArcIdentityService.getByAgentId = async () => {
      identityLookupCalled = true;
      return { registration_status: 'failed' };
    };

    try {
      delete require.cache[require.resolve('../src/routes/owner')];
      const ownerRoutes = require('../src/routes/owner');
      const res = await invokeRoute(ownerRoutes, 'post', '/agents/:id/arc-identity/retry', {
        ownerEmail: 'owner@example.com',
        params: { id: 'agent-2' }
      });

      assertEqual(res.statusCode, 403);
      assertEqual(identityLookupCalled, false, 'Should stop before retrying arc identity');
    } finally {
      AgentService.getById = originalGetById;
      ArcIdentityService.getByAgentId = originalGetByAgentId;
      delete require.cache[require.resolve('../src/routes/owner')];
    }
  });

  test('owner account cleanup disables active webhooks with the schema-backed columns', async () => {
    const db = require('../src/config/database');
    const originalQueryAll = db.queryAll;
    const originalQuery = db.query;
    const executed = [];

    db.queryAll = async () => [{ id: 'agent-1' }];
    db.query = async (sql, params) => {
      executed.push({ sql, params });
      return { rows: [], rowCount: 1 };
    };

    try {
      delete require.cache[require.resolve('../src/routes/owner')];
      const ownerRoutes = require('../src/routes/owner');
      const res = await invokeRoute(ownerRoutes, 'delete', '/account', {
        ownerEmail: 'owner@example.com'
      });

      assertEqual(res.statusCode, 204);
      const webhookUpdate = executed.find((entry) => entry.sql.includes('UPDATE agent_webhooks'));
      assert(webhookUpdate, 'Expected owner account deletion to update agent webhooks');
      assert(webhookUpdate.sql.includes("status = 'disabled'"), 'Webhook cleanup should disable status');
      assert(webhookUpdate.sql.includes('disabled_at = NOW()'), 'Webhook cleanup should stamp disabled_at');
      assert(webhookUpdate.sql.includes('updated_at = NOW()'), 'Webhook cleanup should stamp updated_at');
    } finally {
      db.queryAll = originalQueryAll;
      db.query = originalQuery;
      delete require.cache[require.resolve('../src/routes/owner')];
    }
  });

  test('mcp create_post delegates to AgentActionService with bearer token context', async () => {
    const AgentService = require('../src/services/AgentService');
    const originalFindByApiKey = AgentService.findByApiKey;
    const originalCreatePost = AgentActionService.createPost;
    const apiKey = generateApiKey();
    let capturedArgs = null;

    AgentService.findByApiKey = async (token) => {
      assertEqual(token, apiKey);
      return {
        id: 'agent-1',
        name: 'alice',
        display_name: 'Alice',
        owner_email: 'owner@example.com',
        status: 'active',
        created_at: new Date().toISOString()
      };
    };
    AgentActionService.createPost = async (args) => {
      capturedArgs = args;
      return { id: 'post-1', ok: true };
    };

    try {
      delete require.cache[require.resolve('../src/routes/mcp')];
      const mcpRoutes = require('../src/routes/mcp');
      const res = await invokeRoute(mcpRoutes, 'post', '/', {
        headers: { authorization: `Bearer ${apiKey}` },
        ip: '127.0.0.1',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'create_post',
            arguments: { title: 'Hi', content: 'There', hub: 'general' }
          }
        }
      });

      assertEqual(res.statusCode, 200);
      assertEqual(capturedArgs.token, apiKey);
      assertEqual(capturedArgs.ip, '127.0.0.1');
      assertEqual(capturedArgs.hubSlug, 'general');
      const payload = JSON.parse(res.body.result.content[0].text);
      assertEqual(payload.id, 'post-1');
    } finally {
      AgentService.findByApiKey = originalFindByApiKey;
      AgentActionService.createPost = originalCreatePost;
      delete require.cache[require.resolve('../src/routes/mcp')];
    }
  });
});

describe('Owner Email Uniqueness', () => {
  test('setupOwnerEmail rejects duplicate owner emails case-insensitively', async () => {
    const db = require('../src/config/database');
    const originalQueryOne = db.queryOne;
    const originalQuery = db.query;

    db.queryOne = async () => ({ id: 'agent-2' });
    db.query = async () => {
      throw new Error('query should not run when owner email is duplicated');
    };

    delete require.cache[require.resolve('../src/services/AgentService')];
    const AgentService = require('../src/services/AgentService');

    try {
      let threw = false;
      try {
        await AgentService.setupOwnerEmail('agent-1', 'Owner@Example.com');
      } catch (error) {
        threw = true;
        assert(error.message.includes('already registered with this email address'), 'Expected duplicate owner email rejection');
      }

      assert(threw, 'Expected setupOwnerEmail to reject duplicates');
    } finally {
      db.queryOne = originalQueryOne;
      db.query = originalQuery;
      delete require.cache[require.resolve('../src/services/AgentService')];
    }
  });

  test('update rejects duplicate owner emails case-insensitively', async () => {
    const db = require('../src/config/database');
    const originalQueryOne = db.queryOne;
    const originalQuery = db.query;

    db.queryOne = async (sql) => {
      if (sql.includes('FROM agents') && sql.includes('LOWER(owner_email)')) {
        return { id: 'agent-2' };
      }
      return null;
    };
    db.query = async () => {
      throw new Error('query should not run when owner email is duplicated');
    };

    delete require.cache[require.resolve('../src/services/AgentService')];
    const AgentService = require('../src/services/AgentService');

    try {
      let threw = false;
      try {
        await AgentService.update('agent-1', { ownerEmail: 'Owner@Example.com' });
      } catch (error) {
        threw = true;
        assert(error.message.includes('already registered with this email address'), 'Expected duplicate owner email rejection');
      }

      assert(threw, 'Expected update to reject duplicates');
    } finally {
      db.queryOne = originalQueryOne;
      db.query = originalQuery;
      delete require.cache[require.resolve('../src/services/AgentService')];
    }
  });
});

describe('Route Mounts', () => {
  test('api router mounts hubs alias alongside submolts', () => {
    const routePatterns = apiRoutes.stack
      .filter((layer) => layer && layer.regexp)
      .map((layer) => String(layer.regexp));

    assert(routePatterns.some((pattern) => pattern.includes('hubs')), 'Expected /hubs router mount');
    assert(routePatterns.some((pattern) => pattern.includes('submolts')), 'Expected /submolts router mount');
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
