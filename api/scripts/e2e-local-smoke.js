#!/usr/bin/env node
require('dotenv').config();

const { spawn } = require('child_process');
const { Pool } = require('pg');
const config = require('../src/config');
const { buildOwnerCookie } = require('../src/utils/auth');

const E2E_PORT = Number(process.env.E2E_PORT || 3301);
const API_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
const API_BASE = `${API_ORIGIN}/api/v1`;
const WEB_ORIGIN = 'http://127.0.0.1:3300';
const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';

const state = {
  handles: [],
  emails: [],
  hubSlugs: [],
  steps: [],
  serverLogs: '',
  magicLinks: new Map()
};

let serverProcess = null;
let pool = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function apiRequest(method, path, { token, cookie, body, headers } = {}) {
  const requestHeaders = {
    ...(headers || {})
  };

  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (cookie) requestHeaders.cookie = cookie;
  if (body !== undefined && !requestHeaders['content-type']) {
    requestHeaders['content-type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined
      ? undefined
      : requestHeaders['content-type'] === 'application/json'
        ? JSON.stringify(body)
        : body,
    redirect: 'manual'
  });

  const text = await response.text();
  let payload = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // keep text body
  }

  return {
    status: response.status,
    headers: response.headers,
    body: payload
  };
}

async function step(name, fn, { optional = false } = {}) {
  try {
    const result = await fn();
    state.steps.push({ name, ok: true, optional, result });
    log(`PASS ${name}`);
    return result;
  } catch (error) {
    const entry = {
      name,
      ok: false,
      optional,
      error: error.message
    };
    state.steps.push(entry);
    if (optional) {
      log(`SKIP ${name} -> ${error.message}`);
      return null;
    }
    throw error;
  }
}

function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(`${label} expected ${expected}, got ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

function parseMagicLinks(chunk) {
  const regex = /\[EmailService\] Magic link for ([^:\n]+):\s*\n(https?:\/\/[^\s]+\/auth\/owner\/verify\?token=([^\s&]+))/g;
  let match;
  while ((match = regex.exec(chunk)) !== null) {
    state.magicLinks.set(match[1].trim().toLowerCase(), {
      url: match[2],
      token: match[3]
    });
  }
}

async function waitForMagicLink(email, timeoutMs = 10_000) {
  const normalized = email.toLowerCase();
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const entry = state.magicLinks.get(normalized);
    if (entry) return entry;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for magic link for ${email}`);
}

async function waitForHealth(timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${API_BASE}/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error('Timed out waiting for local API health check');
}

function normalizeChallengeText(text) {
  return String(text || '')
    .replace(/[^a-z0-9\s.?]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function solveChallenge(challengeText) {
  const normalized = normalizeChallengeText(challengeText);
  const numbers = normalized.match(/\d+/g)?.map((value) => Number(value)) || [];
  if (numbers.length < 2) {
    throw new Error(`Could not parse verification challenge: ${challengeText}`);
  }
  const [a, b] = numbers;

  if (normalized.includes('finds') && normalized.includes('more')) {
    return (a + b).toFixed(2);
  }
  if (normalized.includes('drifts back')) {
    return (a - b).toFixed(2);
  }
  if (normalized.includes('each leave')) {
    return (a * b).toFixed(2);
  }

  throw new Error(`Unknown verification challenge format: ${challengeText}`);
}

async function hardCleanup() {
  if (!pool) return;
  const handles = [...new Set(state.handles)];
  const emails = [...new Set(state.emails.map((email) => email.toLowerCase()))];
  const hubSlugs = [...new Set(state.hubSlugs)];

  if (!handles.length && !emails.length && !hubSlugs.length) return;

  await pool.query('BEGIN');
  try {
    const agentRows = handles.length
      ? (await pool.query(`SELECT id, name FROM agents WHERE name = ANY($1)`, [handles])).rows
      : [];
    const agentIds = agentRows.map((row) => row.id);

    const hubRows = (agentIds.length || hubSlugs.length)
      ? (await pool.query(
          `SELECT id, slug
           FROM hubs
           WHERE ($1::uuid[] <> '{}'::uuid[] AND creator_id = ANY($1))
              OR ($2::text[] <> '{}'::text[] AND slug = ANY($2))`,
          [agentIds, hubSlugs]
        )).rows
      : [];
    const hubIds = hubRows.map((row) => row.id);

    const postRows = agentIds.length
      ? (await pool.query(`SELECT id FROM posts WHERE author_id = ANY($1)`, [agentIds])).rows
      : [];
    const commentRows = agentIds.length
      ? (await pool.query(`SELECT id FROM comments WHERE author_id = ANY($1)`, [agentIds])).rows
      : [];
    const postIds = postRows.map((row) => Number(row.id));
    const commentIds = commentRows.map((row) => Number(row.id));

    if (agentIds.length || hubIds.length) {
      await pool.query(
        `DELETE FROM moderation_actions
         WHERE ($1::uuid[] <> '{}'::uuid[] AND actor_id = ANY($1))
            OR ($2::bigint[] <> '{}'::bigint[] AND hub_id = ANY($2))`,
        [agentIds, hubIds]
      );
    }

    if (postIds.length || commentIds.length) {
      await pool.query(
        `DELETE FROM content_anchors
         WHERE ($1::bigint[] <> '{}'::bigint[] AND content_type = 'post' AND content_id = ANY($1))
            OR ($2::bigint[] <> '{}'::bigint[] AND content_type = 'comment' AND content_id = ANY($2))`,
        [postIds, commentIds]
      );
      await pool.query(
        `DELETE FROM semantic_documents
         WHERE ($1::bigint[] <> '{}'::bigint[] AND document_type = 'post' AND document_id::bigint = ANY($1))
            OR ($2::bigint[] <> '{}'::bigint[] AND document_type = 'comment' AND document_id::bigint = ANY($2))`,
        [postIds, commentIds]
      );
    }

    if (handles.length || hubSlugs.length) {
      await pool.query(
        `DELETE FROM semantic_documents
         WHERE ($1::text[] <> '{}'::text[] AND document_type = 'agent' AND metadata->>'agent_name' = ANY($1))
            OR ($2::text[] <> '{}'::text[] AND document_type = 'submolt' AND metadata->>'submolt_name' = ANY($2))`,
        [handles, hubSlugs]
      );
    }

    if (emails.length) {
      await pool.query(`DELETE FROM developer_apps WHERE LOWER(owner_email) = ANY($1)`, [emails]);
      await pool.query(`DELETE FROM owner_magic_links WHERE LOWER(email) = ANY($1)`, [emails]);
    }

    if (hubIds.length) {
      await pool.query(`DELETE FROM hubs WHERE id = ANY($1)`, [hubIds]);
    }

    if (agentIds.length) {
      await pool.query(`DELETE FROM agents WHERE id = ANY($1)`, [agentIds]);
    }

    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  pool = new Pool({
    connectionString: config.database.url,
    ssl: config.database.ssl
  });

  const childEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(E2E_PORT),
    BASE_URL: API_ORIGIN,
    PUBLIC_API_URL: API_ORIGIN,
    WEB_BASE_URL: WEB_ORIGIN,
    RESEND_API_KEY: ''
  };

  serverProcess = spawn('node', ['src/index.js'], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    state.serverLogs += text;
    parseMagicLinks(state.serverLogs);
    process.stdout.write(`[api] ${text}`);
  });

  serverProcess.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    state.serverLogs += text;
    parseMagicLinks(state.serverLogs);
    process.stderr.write(`[api] ${text}`);
  });

  await waitForHealth();

  const stamp = Date.now();
  const author = {
    handle: `e2e_author_${stamp}`,
    email: `e2e.author.${stamp}@example.com`,
    forwardedFor: '198.51.100.11'
  };
  const mention = {
    handle: `e2e_mention_${stamp}`,
    email: `e2e.mention.${stamp}@example.com`,
    forwardedFor: '198.51.100.12'
  };
  const validator = {
    handle: `e2e_validator_${stamp}`,
    email: `e2e.validator.${stamp}@example.com`,
    forwardedFor: '198.51.100.13'
  };

  state.handles.push(author.handle, mention.handle, validator.handle);
  state.emails.push(author.email, mention.email, validator.email);

  const registerAgent = async (agent, description) => {
    const response = await apiRequest('POST', '/agents/register', {
      headers: { 'x-forwarded-for': agent.forwardedFor },
      body: {
        name: agent.handle,
        display_name: agent.handle,
        description
      }
    });
    const body = expectStatus(response, 200, `register ${agent.handle}`);
    agent.id = body.agent.id;
    agent.apiKey = body.apiKey;
    return body.agent;
  };

  await step('register author', () => registerAgent(author, 'Local E2E author'));
  await step('register mention', () => registerAgent(mention, 'Local E2E mention target'));
  await step('register validator', () => registerAgent(validator, 'Local E2E validator'));

  await step('setup owner emails', async () => {
    for (const agent of [author, mention, validator]) {
      const response = await apiRequest('POST', '/agents/me/setup-owner-email', {
        token: agent.apiKey,
        body: { email: agent.email }
      });
      expectStatus(response, 200, `setup owner email ${agent.handle}`);
    }
    return { count: 3 };
  });

  await step('agent session login/logout', async () => {
    const created = await apiRequest('POST', '/auth/session', {
      body: { apiKey: author.apiKey }
    });
    expectStatus(created, 200, 'create agent session');
    const sessionCookie = created.headers.get('set-cookie');
    if (!sessionCookie) throw new Error('Expected agent session cookie');
    const read = await apiRequest('GET', '/auth/session', { cookie: sessionCookie });
    expectStatus(read, 200, 'read agent session');
    const destroyed = await apiRequest('DELETE', '/auth/session', { cookie: sessionCookie });
    if (destroyed.status !== 204) {
      throw new Error(`destroy session expected 204, got ${destroyed.status}`);
    }
    return { ok: true };
  });

  const authorOwnerCookie = await step('owner magic link + confirm flow', async () => {
    const issue = await apiRequest('POST', '/auth/owner/magic-link', {
      body: { email: author.email }
    });
    expectStatus(issue, 200, 'issue owner magic link');
    const magic = await waitForMagicLink(author.email);
    const verify = await fetch(`${API_BASE}/auth/owner/verify?token=${magic.token}`, { redirect: 'manual' });
    if (verify.status !== 302) {
      throw new Error(`owner verify expected 302, got ${verify.status}`);
    }
    const confirm = await apiRequest('POST', '/auth/owner/confirm', {
      body: { token: magic.token }
    });
    expectStatus(confirm, 200, 'confirm owner magic link');
    const cookie = confirm.headers.get('set-cookie');
    if (!cookie) throw new Error('Expected owner cookie from confirm');
    return cookie;
  });

  const validatorOwnerCookie = buildOwnerCookie(validator.email, config.security.sessionSecret);

  await step('owner me', async () => {
    const response = await apiRequest('GET', '/owner/me', { cookie: authorOwnerCookie });
    const body = expectStatus(response, 200, 'owner me');
    if (!body.primaryAgent || body.primaryAgent.name !== author.handle) {
      throw new Error('Owner me did not return the author as primary agent');
    }
    return { agentCount: body.agents.length };
  });

  await step('author me/status/home', async () => {
    const me = expectStatus(await apiRequest('GET', '/agents/me', { token: author.apiKey }), 200, 'agents me');
    const status = expectStatus(await apiRequest('GET', '/agents/status', { token: author.apiKey }), 200, 'agents status');
    const home = expectStatus(await apiRequest('GET', '/home', { token: author.apiKey }), 200, 'home');
    if (!me.agent.canPost || !home.your_account.can_post) {
      throw new Error('Author should be able to post after owner email setup');
    }
    return { status: status.status, canPost: home.your_account.can_post };
  });

  await step('update profile + capabilities manifest', async () => {
    const updated = expectStatus(await apiRequest('PATCH', '/agents/me', {
      token: author.apiKey,
      body: {
        displayName: 'E2E Author',
        description: 'Author updated by local E2E',
        capabilities: JSON.stringify({
          schema: 'arcbook.capabilities/v1',
          version: '1.0',
          tags: ['e2e', 'search']
        })
      }
    }), 200, 'update me');

    const manifest = await fetch(`${API_BASE}/agents/${author.handle}/capabilities.md`);
    const markdown = await manifest.text();
    if (!manifest.ok || !markdown.includes('arcbook.capabilities/v1')) {
      throw new Error('capabilities manifest did not render structured capabilities');
    }

    const list = expectStatus(await apiRequest('GET', `/agents?capability=e2e&sort=karma`), 200, 'list agents by capability');
    return { updatedName: updated.agent.displayName, listCount: list.agents.length };
  });

  let hub;
  await step('create hub and manage membership', async () => {
    const slug = `e2e-hub-${stamp}`;
    state.hubSlugs.push(slug);
    const createdHub = expectStatus(await apiRequest('POST', '/hubs', {
      token: author.apiKey,
      body: {
        slug,
        displayName: `E2E Hub ${stamp}`,
        description: 'Hub for local E2E smoke'
      }
    }), 200, 'create hub');

    if (!createdHub.verification_required || !createdHub.submolt?.verification?.verification_code) {
      throw new Error('Expected verification-required hub create');
    }

    const answer = solveChallenge(createdHub.submolt.verification.challenge_text);
    expectStatus(await apiRequest('POST', '/verify', {
      token: author.apiKey,
      body: {
        verification_code: createdHub.submolt.verification.verification_code,
        answer
      }
    }), 200, 'verify created hub');

    hub = createdHub.submolt;

    expectStatus(await apiRequest('GET', `/hubs/${slug}`), 200, 'get hub');
    expectStatus(await apiRequest('POST', `/hubs/${slug}/subscribe`, { token: mention.apiKey, body: {} }), 200, 'subscribe hub');
    const moderators = expectStatus(await apiRequest('GET', `/hubs/${slug}/moderators`), 200, 'list moderators');
    return { hubId: hub.id, moderatorCount: moderators.moderators.length };
  });

  let post;
  let comment;
  await step('post, comment, mentions, votes, follows, feed, notifications', async () => {
    post = expectStatus(await apiRequest('POST', '/posts', {
      token: author.apiKey,
      body: {
        hub: hub.slug,
        title: `E2E Post ${stamp}`,
        content: `Local smoke post from @${author.handle}`
      }
    }), 201, 'create post').post;

    expectStatus(await apiRequest('GET', `/posts/${post.id}`), 200, 'get post');
    expectStatus(await apiRequest('GET', `/posts?sort=hot&limit=5`), 200, 'list posts');

    comment = expectStatus(await apiRequest('POST', `/posts/${post.id}/comments`, {
      token: mention.apiKey,
      body: {
        content: `Hello @${validator.handle} from local E2E comment`
      }
    }), 201, 'create comment').comment;

    expectStatus(await apiRequest('GET', `/posts/${post.id}/comments`, { token: author.apiKey }), 200, 'list comments');

    await pool.query(`UPDATE agents SET karma = 10 WHERE id = $1`, [validator.id]);
    expectStatus(await apiRequest('POST', `/posts/${post.id}/upvote`, { token: validator.apiKey, body: {} }), 200, 'upvote post');
    expectStatus(await apiRequest('POST', `/posts/${post.id}/downvote`, { token: validator.apiKey, body: {} }), 200, 'downvote post');
    expectStatus(await apiRequest('POST', `/comments/${comment.id}/upvote`, { token: validator.apiKey, body: {} }), 200, 'upvote comment');
    expectStatus(await apiRequest('POST', `/comments/${comment.id}/downvote`, { token: validator.apiKey, body: {} }), 200, 'downvote comment');

    expectStatus(await apiRequest('POST', `/agents/${author.handle}/follow`, { token: mention.apiKey, body: {} }), 200, 'follow author');
    expectStatus(await apiRequest('GET', '/posts?filter=following&limit=5', { token: mention.apiKey }), 200, 'following feed');
    expectStatus(await apiRequest('DELETE', `/agents/${author.handle}/follow`, { token: mention.apiKey }), 200, 'unfollow author');

    const mentions = expectStatus(await apiRequest('GET', '/agents/me/mentions', { token: validator.apiKey }), 200, 'get mentions');
    const notifications = expectStatus(await apiRequest('GET', '/notifications', { token: validator.apiKey }), 200, 'list notifications');
    expectStatus(await apiRequest('POST', '/notifications/read-all', { token: validator.apiKey, body: {} }), 200, 'read all notifications');
    expectStatus(await apiRequest('POST', '/agents/me/heartbeat', { token: author.apiKey, body: {} }), 200, 'heartbeat');

    return {
      postId: post.id,
      commentId: comment.id,
      mentionCount: mentions.count,
      notificationCount: notifications.unreadCount
    };
  });

  let mediaAsset;
  await step('media upload', async () => {
    mediaAsset = expectStatus(await apiRequest('POST', '/media/images', {
      token: author.apiKey,
      body: {
        usage: 'post_image',
        contentType: 'image/png',
        data: PNG_1X1_BASE64,
        filename: `e2e-${stamp}.png`
      }
    }), 201, 'media upload').asset;
    return { mediaId: mediaAsset.id };
  });

  let skill;
  await step('skills register and list', async () => {
    skill = expectStatus(await apiRequest('POST', '/skills', {
      token: author.apiKey,
      body: {
        skillName: `e2e-skill-${String(stamp).slice(-6)}`,
        skillVersion: '1.0.0',
        skillUrl: `${WEB_ORIGIN}/skills/e2e`,
        skillDescription: 'Local E2E skill registration',
        license: 'MIT'
      }
    }), 201, 'create skill').skill;

    expectStatus(await apiRequest('GET', '/skills?limit=5'), 200, 'list skills');
    expectStatus(await apiRequest('GET', `/agents/${author.handle}/skills`), 200, 'agent skills');
    return { skillId: skill.id };
  });

  let developerApp;
  await step('developer app + identity token verification', async () => {
    expectStatus(await apiRequest('GET', '/owner/developer-apps', { cookie: authorOwnerCookie }), 200, 'list developer apps');
    developerApp = expectStatus(await apiRequest('POST', '/owner/developer-apps', {
      cookie: authorOwnerCookie,
      body: { name: `e2e-app-${stamp}` }
    }), 201, 'create developer app');

    const tokenResponse = expectStatus(await apiRequest('POST', '/agents/me/identity-token', {
      token: author.apiKey,
      body: { audience: 'local-e2e' }
    }), 200, 'identity token');

    const verified = expectStatus(await apiRequest('POST', '/agents/verify-identity', {
      headers: { 'x-arcbook-app-key': developerApp.appKey },
      body: { token: tokenResponse.token, audience: 'local-e2e' }
    }), 200, 'verify identity token');

    expectStatus(await apiRequest('DELETE', `/owner/developer-apps/${developerApp.app.id}`, {
      cookie: authorOwnerCookie
    }), 200, 'delete developer app');

    return { appId: developerApp.app.id, valid: verified.valid };
  });

  let dmConversationId;
  await step('dm request approve send conversation', async () => {
    const request = expectStatus(await apiRequest('POST', '/agents/dm/request', {
      token: author.apiKey,
      body: {
        to: validator.handle,
        message: 'Local E2E DM request. Please approve.'
      }
    }), 200, 'create dm request');
    dmConversationId = request.conversation_id;

    expectStatus(await apiRequest('GET', '/agents/dm/requests', { token: validator.apiKey }), 200, 'list dm requests');
    expectStatus(await apiRequest('POST', `/agents/dm/requests/${dmConversationId}/approve`, {
      token: validator.apiKey,
      body: {}
    }), 200, 'approve dm request');
    expectStatus(await apiRequest('GET', `/agents/dm/conversations/${dmConversationId}`, {
      token: validator.apiKey
    }), 200, 'get dm conversation');
    expectStatus(await apiRequest('POST', `/agents/dm/conversations/${dmConversationId}/send`, {
      token: author.apiKey,
      body: { message: 'Local E2E DM follow-up.' }
    }), 200, 'send dm');
    expectStatus(await apiRequest('GET', '/agents/dm/conversations', { token: validator.apiKey }), 200, 'list dm conversations');
    return { conversationId: dmConversationId };
  });

  await step('reputation feedback and history', async () => {
    expectStatus(await apiRequest('POST', `/agents/${author.handle}/reputation/feedback`, {
      token: validator.apiKey,
      body: {
        score: 95,
        feedbackType: 'general',
        tag: 'e2e',
        comment: 'Local E2E feedback'
      }
    }), 200, 'give reputation feedback');

    const history = expectStatus(await apiRequest('GET', `/agents/${author.handle}/reputation?limit=5`), 200, 'get reputation history');
    return { totalFeedback: history.totalFeedback };
  });

  let validationRequest;
  await step('validation request respond status', async () => {
    validationRequest = expectStatus(await apiRequest('POST', '/agents/me/validation/request', {
      token: author.apiKey,
      body: {
        validatorAddress: '0x1111111111111111111111111111111111111111',
        targetAgentId: author.id,
        requestDescription: 'Local E2E validation request'
      }
    }), 200, 'create validation request').request;

    expectStatus(await apiRequest('POST', '/agents/validation/respond', {
      token: validator.apiKey,
      body: {
        requestHash: validationRequest.request_hash,
        response: 100,
        responseDescription: 'Validation passed in local E2E',
        tag: 'e2e'
      }
    }), 200, 'submit validation response');

    const status = expectStatus(await apiRequest('GET', `/agents/validation/${validationRequest.request_hash}/status`), 200, 'get validation status');
    return { status: status.validation.status };
  });

  await step('arc identity get and patch', async () => {
    expectStatus(await apiRequest('GET', '/agents/me/arc/identity', { token: author.apiKey }), 200, 'get arc identity');
    expectStatus(await apiRequest('PATCH', '/agents/me/arc/identity', {
      token: author.apiKey,
      body: {
        description: 'Arc identity patched in local E2E',
        capabilities: { tags: ['e2e', 'identity'] },
        services: [{ type: 'mcp', url: `${WEB_ORIGIN}/mcp` }]
      }
    }), 200, 'patch arc identity');
    return { ok: true };
  });

  await step('arc identity register', async () => {
    const missingCircle = !config.circle.apiKey || !config.circle.entitySecret || !config.circle.treasuryWalletId;
    if (missingCircle) {
      throw new Error('Circle credentials not configured for local Arc identity registration');
    }
    const registered = expectStatus(await apiRequest('POST', '/agents/me/arc/identity/register', {
      token: author.apiKey,
      body: {}
    }), 200, 'register arc identity');
    return { status: registered.arcIdentity.status };
  }, { optional: true });

  await step('x verification start', async () => {
    const started = expectStatus(await apiRequest('POST', '/agents/me/x-verify/start', {
      token: author.apiKey,
      body: {}
    }), 200, 'start x verification');
    return { code: started.code };
  });

  await step('x verification confirm', async () => {
    const tweetUrl = process.env.E2E_X_TWEET_URL;
    if (!tweetUrl) {
      throw new Error('Set E2E_X_TWEET_URL to exercise /agents/me/x-verify/confirm');
    }
    const confirmed = expectStatus(await apiRequest('POST', '/agents/me/x-verify/confirm', {
      token: author.apiKey,
      body: { tweetUrl }
    }), 200, 'confirm x verification');
    return { ownerHandle: confirmed.owner_handle || null };
  }, { optional: true });

  let reportForDismiss;
  let reportForResolve;
  let reportForAction;
  await step('moderation reports queue actions', async () => {
    expectStatus(await apiRequest('POST', `/hubs/${hub.slug}/moderators`, {
      token: author.apiKey,
      body: { agentName: validator.handle }
    }), 200, 'add moderator');
    expectStatus(await apiRequest('GET', `/hubs/${hub.slug}/moderators`, { token: validator.apiKey }), 200, 'list moderators after add');

    const mentionPost = expectStatus(await apiRequest('POST', '/posts', {
      token: mention.apiKey,
      body: {
        hub: hub.slug,
        title: `Mention Post ${stamp}`,
        content: 'Post to moderate in local E2E'
      }
    }), 201, 'mention post').post;

    reportForDismiss = expectStatus(await apiRequest('POST', '/reports', {
      token: author.apiKey,
      body: {
        targetType: 'comment',
        targetId: String(comment.id),
        reason: 'spam',
        notes: 'Dismiss path'
      }
    }), 201, 'create dismiss report').report;

    reportForResolve = expectStatus(await apiRequest('POST', '/reports', {
      token: author.apiKey,
      body: {
        targetType: 'post',
        targetId: String(mentionPost.id),
        reason: 'abuse',
        notes: 'Resolve path'
      }
    }), 201, 'create resolve report').report;

    reportForAction = expectStatus(await apiRequest('POST', '/reports', {
      token: author.apiKey,
      body: {
        targetType: 'post',
        targetId: String(mentionPost.id),
        reason: 'mod_action',
        notes: 'Action path'
      }
    }), 201, 'create action report').report;

    expectStatus(await apiRequest('GET', `/mod/queue?hub=${hub.slug}&status=open`, {
      token: validator.apiKey
    }), 200, 'moderation queue');
    expectStatus(await apiRequest('POST', `/mod/reports/${reportForDismiss.id}/dismiss`, {
      token: validator.apiKey,
      body: {}
    }), 200, 'dismiss report');
    expectStatus(await apiRequest('POST', `/mod/reports/${reportForResolve.id}/resolve`, {
      token: validator.apiKey,
      body: {}
    }), 200, 'resolve report');
    expectStatus(await apiRequest('POST', '/mod/actions', {
      token: validator.apiKey,
      body: {
        targetType: 'post',
        targetId: mentionPost.id,
        action: 'lock',
        reason: 'Local E2E moderation action',
        reportId: reportForAction.id
      }
    }), 200, 'moderation action');
    expectStatus(await apiRequest('DELETE', `/hubs/${hub.slug}/moderators/${validator.handle}`, {
      token: author.apiKey
    }), 200, 'remove moderator');
    return { moderatedPostId: mentionPost.id };
  });

  await step('owner refresh api key and anchor retry', async () => {
    const rotated = expectStatus(await apiRequest('POST', `/owner/agents/${author.id}/refresh-api-key`, {
      cookie: authorOwnerCookie,
      body: {}
    }), 200, 'refresh api key');
    author.apiKey = rotated.apiKey;
    expectStatus(await apiRequest('GET', '/agents/me', { token: author.apiKey }), 200, 'author me with refreshed key');
    expectStatus(await apiRequest('POST', `/owner/anchors/post/${post.id}/retry`, {
      cookie: authorOwnerCookie,
      body: {}
    }), 200, 'retry anchor');
    expectStatus(await apiRequest('GET', `/anchors/post/${post.id}`), 200, 'post anchor status');
    expectStatus(await apiRequest('GET', `/anchors/comment/${comment.id}`), 200, 'comment anchor status');
    return { rotated: true };
  });

  await step('verification challenge via submolt create + verify', async () => {
    const slug = `e2e-sub-${stamp}`;
    state.hubSlugs.push(slug);
    const created = expectStatus(await apiRequest('POST', '/submolts', {
      token: author.apiKey,
      body: {
        slug,
        displayName: `E2E Submolt ${stamp}`,
        description: 'Submolt verification smoke'
      }
    }), 200, 'create submolt with verification');

    if (!created.verification_required || !created.submolt?.verification?.verification_code) {
      throw new Error('Expected verification-required submolt create');
    }

    const answer = solveChallenge(created.submolt.verification.challenge_text);
    const verified = expectStatus(await apiRequest('POST', '/verify', {
      token: author.apiKey,
      body: {
        verification_code: created.submolt.verification.verification_code,
        answer
      }
    }), 200, 'complete verification');

    return {
      submoltId: created.submolt.id,
      verifiedContentType: verified.content_type
    };
  });

  await step('owner account delete', async () => {
    const response = await apiRequest('DELETE', '/owner/account', { cookie: validatorOwnerCookie });
    if (response.status !== 204) {
      throw new Error(`owner account delete expected 204, got ${response.status}`);
    }
    return { deleted: validator.handle };
  });

  const mandatoryFailures = state.steps.filter((entry) => !entry.ok && !entry.optional);
  if (mandatoryFailures.length) {
    throw new Error(`Local E2E smoke failed at ${mandatoryFailures[0].name}`);
  }

  log('\nLocal E2E smoke completed successfully.');
  for (const entry of state.steps) {
    if (entry.ok) continue;
    log(`Optional skip: ${entry.name} -> ${entry.error}`);
  }
}

async function shutdown(exitCode = 0, error = null) {
  try {
    await hardCleanup();
  } catch (cleanupError) {
    process.stderr.write(`Cleanup failed: ${cleanupError.stack || cleanupError.message}\n`);
    exitCode = 1;
  }

  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    await sleep(500);
  }

  if (pool) {
    await pool.end().catch(() => {});
  }

  if (error) {
    process.stderr.write(`\nLocal E2E smoke failed: ${error.stack || error.message}\n`);
    process.exit(exitCode || 1);
  }

  process.exit(exitCode);
}

(async () => {
  try {
    await main();
    await shutdown(0);
  } catch (error) {
    await shutdown(1, error);
  }
})();
