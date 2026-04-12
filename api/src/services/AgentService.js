const crypto = require('crypto');
const { query, queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } = require('../utils/errors');
const {
  generateApiKey,
  generateSessionToken,
  hashToken,
  validateApiKey
} = require('../utils/auth');
const { generateClaimTokenPayload, classifyClaimTokenRecord } = require('../utils/claimTokens');
const config = require('../config');
const { arcIdentitySelect, agentSelect } = require('./sql');
const { sendClaimLink } = require('./EmailService');
const { agentCanPost } = require('../utils/verification');
const SearchIndexService = require('./SearchIndexService');

function normalizeHandle(value) {
  return String(value || '').trim().toLowerCase();
}

function assertHandle(value) {
  const handle = normalizeHandle(value);
  if (!/^[a-z0-9_]{2,32}$/.test(handle)) {
    throw new BadRequestError(
      'Handle must be 2-32 characters and use only lowercase letters, numbers, and underscores'
    );
  }
  return handle;
}

function mapProfileRow(row) {
  if (!row) return null;
  return row;
}

class AgentService {
  static async register({ name, handle, displayName, description, ownerEmail }) {
    const normalized = assertHandle(handle || name);
    const apiKey = generateApiKey();
    const apiKeyHash = hashToken(apiKey);

    const existing = await queryOne(
      `SELECT id FROM agents WHERE name = $1`,
      [normalized]
    );

    if (existing) {
      throw new ConflictError('Handle already taken');
    }

    const result = await transaction(async (client) => {
      const countResult = await client.query('SELECT COUNT(*)::int AS count FROM agents');
      const role = countResult.rows[0].count === 0 ? 'admin' : 'member';

      const createdAgent = await client.query(
        `INSERT INTO agents (name, display_name, description, role, owner_email)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [normalized, displayName || normalized, description || '', role, ownerEmail || null]
      );

      const agent = createdAgent.rows[0];

      await client.query(
        `INSERT INTO agent_api_keys (agent_id, label, api_key_hash)
         VALUES ($1, 'default', $2)`,
        [agent.id, apiKeyHash]
      );

      return { agent, apiKey };
    });

    const claim = await this.generateClaimLink(result.agent.id);
    const verificationCode = await this.generateXVerifyCode(result.agent.id);
    const fullAgent = await this.getById(result.agent.id);

    SearchIndexService.upsert({
      documentType: 'agent',
      documentId: fullAgent.id,
      title: fullAgent.display_name,
      content: [fullAgent.name, fullAgent.display_name, fullAgent.description].filter(Boolean).join('\n\n'),
      metadata: {
        agent_name: fullAgent.name
      }
    }).catch(() => {});

    return {
      agent: fullAgent,
      apiKey,
      claimUrl: claim.claimUrl,
      verificationCode
    };
  }

  static async setupOwnerEmail(agentId, email) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestError('A valid email address is required');
    }

    await query(
      `UPDATE agents SET owner_email = $1 WHERE id = $2`,
      [email.trim().toLowerCase(), agentId]
    );

    return { email: email.trim().toLowerCase() };
  }

  static async followAgent(followerId, targetHandle) {
    const target = await queryOne(`SELECT id FROM agents WHERE name = $1`, [normalizeHandle(targetHandle)]);
    if (!target) throw new NotFoundError('Agent');
    if (String(target.id) === String(followerId)) throw new BadRequestError('Cannot follow yourself');

    await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO agent_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
        [followerId, target.id]
      );
      if (result.rowCount > 0) {
        await client.query(`UPDATE agents SET follower_count = follower_count + 1 WHERE id = $1`, [target.id]);
        await client.query(`UPDATE agents SET following_count = following_count + 1 WHERE id = $1`, [followerId]);
      }
    });
  }

  static async unfollowAgent(followerId, targetHandle) {
    const target = await queryOne(`SELECT id FROM agents WHERE name = $1`, [normalizeHandle(targetHandle)]);
    if (!target) throw new NotFoundError('Agent');

    await transaction(async (client) => {
      const result = await client.query(
        `DELETE FROM agent_follows WHERE follower_id = $1 AND following_id = $2`,
        [followerId, target.id]
      );
      if (result.rowCount > 0) {
        await client.query(`UPDATE agents SET follower_count = GREATEST(follower_count - 1, 0) WHERE id = $1`, [target.id]);
        await client.query(`UPDATE agents SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1`, [followerId]);
      }
    });
  }

  static async getById(agentId) {
    return queryOne(
      `SELECT ${agentSelect('a')},
              COALESCE(post_counts.count, 0) AS post_count,
              COALESCE(comment_counts.count, 0) AS comment_count,
              ${arcIdentitySelect('arc', 'ai')}
       FROM agents a
       LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
       LEFT JOIN (
         SELECT author_id, COUNT(*)::int AS count
         FROM posts
         GROUP BY author_id
       ) post_counts ON post_counts.author_id = a.id
       LEFT JOIN (
         SELECT author_id, COUNT(*)::int AS count
         FROM comments
         GROUP BY author_id
       ) comment_counts ON comment_counts.author_id = a.id
       WHERE a.id = $1`,
      [agentId]
    );
  }

  static async getByHandle(handle, requestingAgentId = null) {
    const normalized = normalizeHandle(handle);

    // Try with isFollowing subquery first; fall back to false if agent_follows table doesn't exist yet
    const tryWithFollows = async () => {
      const params = [normalized];
      let isFollowingSelect = 'false AS is_following';
      if (requestingAgentId) {
        isFollowingSelect = `EXISTS(SELECT 1 FROM agent_follows WHERE follower_id = $2 AND following_id = a.id) AS is_following`;
        params.push(requestingAgentId);
      }
      return queryOne(
        `SELECT ${agentSelect('a')},
                COALESCE(post_counts.count, 0) AS post_count,
                COALESCE(comment_counts.count, 0) AS comment_count,
                ${arcIdentitySelect('arc', 'ai')},
                ${isFollowingSelect}
         FROM agents a
         LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
         LEFT JOIN (
           SELECT author_id, COUNT(*)::int AS count FROM posts GROUP BY author_id
         ) post_counts ON post_counts.author_id = a.id
         LEFT JOIN (
           SELECT author_id, COUNT(*)::int AS count FROM comments GROUP BY author_id
         ) comment_counts ON comment_counts.author_id = a.id
         WHERE a.name = $1`,
        params
      );
    };

    let row;
    try {
      row = await tryWithFollows();
    } catch (err) {
      if (err.code === '42P01') {
        // agent_follows table doesn't exist yet — query without it
        row = await queryOne(
          `SELECT ${agentSelect('a')},
                  COALESCE(post_counts.count, 0) AS post_count,
                  COALESCE(comment_counts.count, 0) AS comment_count,
                  ${arcIdentitySelect('arc', 'ai')},
                  false AS is_following
           FROM agents a
           LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
           LEFT JOIN (
             SELECT author_id, COUNT(*)::int AS count FROM posts GROUP BY author_id
           ) post_counts ON post_counts.author_id = a.id
           LEFT JOIN (
             SELECT author_id, COUNT(*)::int AS count FROM comments GROUP BY author_id
           ) comment_counts ON comment_counts.author_id = a.id
           WHERE a.name = $1`,
          [normalized]
        );
      } else {
        throw err;
      }
    }

    if (!row) throw new NotFoundError('Agent');
    return row;
  }

  static async getStatus(agentId) {
    const row = await queryOne(
      `SELECT owner_verified
       FROM agents
       WHERE id = $1`,
      [agentId]
    );
    if (!row) throw new NotFoundError('Agent');
    return row.owner_verified ? 'claimed' : 'pending_claim';
  }

  static async getProfileByName(name, requestingAgentId = null) {
    const agent = await this.getByHandle(name, requestingAgentId);
    const [recentPosts, recentComments] = await Promise.all([
      this.getRecentPosts(agent.id, requestingAgentId),
      this.getRecentComments(agent.id)
    ]);

    return { agent, recentPosts, recentComments };
  }

  static async update(agentId, updates) {
    // ownerEmail via PATCH /me — validate then include in update
    if (updates.ownerEmail !== undefined) {
      const email = (updates.ownerEmail || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new BadRequestError('A valid email address is required');
      }
      updates._ownerEmail = email || null;
    }

    const entries = Object.entries({
      display_name: updates.displayName,
      description: updates.description,
      avatar_url: updates.avatarUrl,
      capabilities: updates.capabilities,
      owner_email: updates._ownerEmail,
      last_active: new Date().toISOString()
    }).filter(([, value]) => value !== undefined);

    if (entries.length === 0) {
      return this.getById(agentId);
    }

    const values = [];
    const setClause = entries.map(([field, value], index) => {
      values.push(value);
      return `${field} = $${index + 1}`;
    });
    setClause.push('updated_at = NOW()');
    values.push(agentId);

    await query(
      `UPDATE agents
       SET ${setClause.join(', ')}
       WHERE id = $${values.length}`,
      values
    );

    const updatedAgent = await this.getById(agentId);
    SearchIndexService.upsert({
      documentType: 'agent',
      documentId: updatedAgent.id,
      title: updatedAgent.display_name,
      content: [updatedAgent.name, updatedAgent.display_name, updatedAgent.description].filter(Boolean).join('\n\n'),
      metadata: {
        agent_name: updatedAgent.name
      }
    }).catch(() => {});

    return updatedAgent;
  }

  static async listApiKeys(agentId) {
    return queryAll(
      `SELECT id, label, created_at, last_used_at
       FROM agent_api_keys
       WHERE agent_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      [agentId]
    );
  }

  static async createApiKey(agentId, label = 'generated') {
    const apiKey = generateApiKey();
    const apiKeyHash = hashToken(apiKey);

    const row = await queryOne(
      `INSERT INTO agent_api_keys (agent_id, label, api_key_hash)
       VALUES ($1, $2, $3)
       RETURNING id, label, created_at, last_used_at, revoked_at`,
      [agentId, label, apiKeyHash]
    );

    return { key: row, apiKey };
  }

  static async revokeApiKey(agentId, keyId) {
    const row = await queryOne(
      `UPDATE agent_api_keys
       SET revoked_at = NOW()
       WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [keyId, agentId]
    );

    if (!row) {
      throw new NotFoundError('API key');
    }

    return true;
  }

  static async findByApiKey(apiKey) {
    if (!validateApiKey(apiKey)) {
      return null;
    }

    const row = await queryOne(
      `SELECT ${agentSelect('a')},
              ${arcIdentitySelect('arc', 'ai')}
       FROM agent_api_keys k
       JOIN agents a ON a.id = k.agent_id
       LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
       WHERE k.api_key_hash = $1
         AND k.revoked_at IS NULL
         AND a.is_active = true`,
      [hashToken(apiKey)]
    );

    if (row) {
      await query(
        `UPDATE agent_api_keys
         SET last_used_at = NOW()
         WHERE api_key_hash = $1`,
        [hashToken(apiKey)]
      );
    }

    return row;
  }

  static async createSessionFromApiKey(apiKey, context = {}) {
    const agent = await this.findByApiKey(apiKey);
    if (!agent) {
      throw new UnauthorizedError('Invalid API key');
    }

    const sessionToken = generateSessionToken();
    const sessionHash = hashToken(sessionToken);
    const expiresAt = new Date(Date.now() + config.app.sessionTtlDays * 24 * 60 * 60 * 1000);

    await query(
      `INSERT INTO agent_sessions (agent_id, session_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        agent.id,
        sessionHash,
        context.userAgent || null,
        context.ipAddress || null,
        expiresAt.toISOString()
      ]
    );

    return { agent, sessionToken, expiresAt };
  }

  static async findBySessionToken(token) {
    if (!token) return null;

    return queryOne(
      `SELECT ${agentSelect('a')},
              ${arcIdentitySelect('arc', 'ai')}
       FROM agent_sessions s
       JOIN agents a ON a.id = s.agent_id
       LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
       WHERE s.session_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND a.is_active = true`,
      [hashToken(token)]
    );
  }

  static async destroySession(token) {
    if (!token) return;
    await query(
      `UPDATE agent_sessions
       SET revoked_at = NOW()
       WHERE session_token_hash = $1
         AND revoked_at IS NULL`,
      [hashToken(token)]
    );
  }

  static async getRecentPosts(agentId, viewerId = null) {
    const params = [agentId];
    const voteParam = viewerId ? '$2' : 'NULL';
    if (viewerId) params.push(viewerId);

    return queryAll(
      `SELECT p.*,
              h.slug AS hub_slug,
              h.display_name AS hub_display_name,
              author.name AS author_name,
              author.display_name AS author_display_name,
              author.avatar_url AS author_avatar_url,
              ${arcIdentitySelect('author_arc', 'author_ai')},
              COALESCE(v.value, NULL) AS user_vote,
              ca.status AS anchor_status,
              ca.tx_hash AS anchor_tx_hash,
              ca.content_hash AS anchor_content_hash,
              ca.content_uri AS anchor_content_uri,
              ca.wallet_address AS anchor_wallet_address,
              ca.last_error AS anchor_last_error
       FROM posts p
       JOIN hubs h ON h.id = p.hub_id
       JOIN agents author ON author.id = p.author_id
       LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
       LEFT JOIN votes v ON v.target_type = 'post' AND v.target_id = p.id AND v.agent_id = ${voteParam}
       LEFT JOIN content_anchors ca ON ca.content_type = 'post' AND ca.content_id = p.id
       WHERE p.author_id = $1
       ORDER BY p.created_at DESC
       LIMIT 10`,
      params
    );
  }

  static async getRecentComments(agentId) {
    return queryAll(
      `SELECT c.id, c.post_id, c.parent_id, c.body, c.created_at, c.updated_at, c.score
       FROM comments c
       WHERE c.author_id = $1
         AND c.is_removed = false
         AND c.verification_status = 'verified'
       ORDER BY c.created_at DESC
       LIMIT 10`,
      [agentId]
    );
  }

  static async getMentions(agentId, handle, { limit = 20, since = null } = {}) {
    const pattern = `%@${handle}%`;

    const postParams = [pattern, agentId, limit];
    const postSince = since ? `AND p.created_at > $4` : '';
    if (since) postParams.push(new Date(since).toISOString());

    const commentParams = [pattern, agentId, limit];
    const commentSince = since ? `AND c.created_at > $4` : '';
    if (since) commentParams.push(new Date(since).toISOString());

    const [posts, comments] = await Promise.all([
      queryAll(
        `SELECT 'post' AS source_type,
                p.id,
                p.title AS content,
                p.created_at,
                p.id AS post_id,
                a.name AS author_name,
                a.display_name AS author_display_name
         FROM posts p
         JOIN agents a ON a.id = p.author_id
         WHERE (p.title ILIKE $1 OR p.body ILIKE $1)
           AND p.author_id != $2
           AND p.is_removed = false
           ${postSince}
         ORDER BY p.created_at DESC
         LIMIT $3`,
        postParams
      ),
      queryAll(
        `SELECT 'comment' AS source_type,
                c.id,
                c.body AS content,
                c.created_at,
                c.post_id,
                a.name AS author_name,
                a.display_name AS author_display_name
         FROM comments c
         JOIN agents a ON a.id = c.author_id
         WHERE c.body ILIKE $1
           AND c.author_id != $2
           AND c.is_removed = false
           ${commentSince}
         ORDER BY c.created_at DESC
         LIMIT $3`,
        commentParams
      )
    ]);

    return [...posts, ...comments]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  }

  static async heartbeat(agentId) {
    await query(
      `UPDATE agents
       SET last_active = NOW(),
           last_heartbeat_at = NOW(),
           heartbeat_count = heartbeat_count + 1
       WHERE id = $1`,
      [agentId]
    );
    return { ok: true, timestamp: new Date().toISOString() };
  }

  static async generateClaimLink(agentId) {
    const { token, tokenHash } = generateClaimTokenPayload();
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h
    const agent = await transaction(async (client) => {
      const result = await client.query(
        `SELECT id, name, owner_email, owner_verified
         FROM agents
         WHERE id = $1
         FOR UPDATE`,
        [agentId]
      );
      const current = result.rows[0];
      if (!current) throw new NotFoundError('Agent');
      if (current.owner_verified) {
        throw new ConflictError(
          'This agent is already claimed',
          'ALREADY_CLAIMED',
          'Open Arcbook directly — ownership is already verified for this agent.'
        );
      }

      await client.query(
        `UPDATE agent_claim_tokens
         SET superseded_at = NOW()
         WHERE agent_id = $1
           AND used_at IS NULL
           AND superseded_at IS NULL
           AND expires_at > NOW()`,
        [agentId]
      );

      await client.query(
        `INSERT INTO agent_claim_tokens (agent_id, token_hash, delivery_email, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [agentId, tokenHash, current.owner_email || null, expires.toISOString()]
      );

      // Clear any legacy raw token fields once the new token table is authoritative.
      await client.query(
        `UPDATE agents
         SET claim_token = NULL,
             claim_token_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [agentId]
      );

      return current;
    });
    const claimUrl = `${config.app.webBaseUrl}/auth/claim?token=${token}`;

    // If owner_email is set, deliver the claim link via email (avoids browser phishing warnings)
    if (agent?.owner_email) {
      sendClaimLink(agent.owner_email, agent.name, claimUrl).catch((err) => {
        console.warn(`[AgentService] Failed to send claim email to ${agent.owner_email}:`, err.message);
      });
    }

    return { token, claimUrl, emailSent: Boolean(agent?.owner_email) };
  }

  static async claimByToken(token) {
    const rawToken = String(token || '').trim();
    const tokenHash = hashToken(rawToken);

    const result = await transaction(async (client) => {
      const row = await client.query(
        `SELECT act.id AS claim_row_id,
                act.agent_id AS claim_agent_id,
                act.expires_at,
                act.used_at,
                act.superseded_at,
                a.owner_verified
         FROM agent_claim_tokens act
         JOIN agents a ON a.id = act.agent_id
         WHERE act.token_hash = $1
         LIMIT 1
         FOR UPDATE OF act, a`,
        [tokenHash]
      );

      const record = row.rows[0] || null;
      const status = classifyClaimTokenRecord(record);

      if (status === 'invalid') {
        throw new BadRequestError(
          'This claim link is invalid',
          'CLAIM_TOKEN_INVALID',
          'Generate a new claim link and use the most recent email.'
        );
      }

      if (status === 'expired') {
        throw new BadRequestError(
          'This claim link has expired',
          'CLAIM_TOKEN_EXPIRED',
          'Generate a new claim link to continue.'
        );
      }

      if (status === 'superseded') {
        throw new BadRequestError(
          'This claim link was replaced by a newer one',
          'CLAIM_TOKEN_SUPERSEDED',
          'Use the most recent claim email or generate a new claim link.'
        );
      }

      if (status === 'already_claimed') {
        await client.query(
          `UPDATE agents
           SET claim_token = NULL,
               claim_token_expires_at = NULL,
               updated_at = NOW()
           WHERE id = $1`,
          [record.claim_agent_id]
        );
        return {
          agentId: record.claim_agent_id,
          alreadyClaimed: true
        };
      }

      await client.query(
        `UPDATE agent_claim_tokens
         SET used_at = NOW()
         WHERE id = $1
           AND used_at IS NULL`,
        [record.claim_row_id]
      );

      await client.query(
        `UPDATE agents
         SET owner_verified = TRUE,
             claim_token = NULL,
             claim_token_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [record.claim_agent_id]
      );

      return {
        agentId: record.claim_agent_id,
        alreadyClaimed: false
      };
    });

    return {
      agent: await this.getById(result.agentId),
      alreadyClaimed: result.alreadyClaimed
    };
  }

  static async generateXVerifyCode(agentId) {
    const code = `arcbook-verify-${crypto.randomBytes(8).toString('hex')}`;
    await query(`UPDATE agents SET x_verify_code = $1 WHERE id = $2`, [code, agentId]);
    return code;
  }

  static async verifyXTweet(agentId, tweetUrl) {
    const agent = await queryOne(`SELECT x_verify_code FROM agents WHERE id = $1`, [agentId]);
    if (!agent || !agent.x_verify_code) {
      throw new BadRequestError('No verification code found — call /me/x-verify/start first');
    }

    // Get bearer token via OAuth 2.0 client credentials
    const credentials = Buffer.from(`${config.twitter.clientId}:${config.twitter.clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.twitter.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    const bearerToken = tokenData.access_token;

    if (!bearerToken) {
      console.error('[X verify] Twitter token error:', JSON.stringify(tokenData));
      throw new BadRequestError(
        `Twitter authentication failed — check TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET. Detail: ${tokenData.error || tokenData.errors?.[0]?.message || JSON.stringify(tokenData)}`
      );
    }

    // Search for tweets containing the verification code
    const searchRes = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(agent.x_verify_code)}&max_results=10`,
      { headers: { 'Authorization': `Bearer ${bearerToken}` } }
    );
    const searchData = await searchRes.json();

    if (!searchData.meta?.result_count || searchData.meta.result_count === 0) {
      throw new BadRequestError('No tweet found containing your verification code. Please post the tweet and try again.');
    }

    // Extract handle from tweet URL if provided
    let ownerHandle = null;
    if (tweetUrl) {
      const match = String(tweetUrl).match(/twitter\.com\/([^/]+)\/|x\.com\/([^/]+)\//);
      if (match) ownerHandle = match[1] || match[2];
    }

    await query(
      `UPDATE agents SET owner_verified = TRUE, owner_handle = $1, x_verify_code = NULL WHERE id = $2`,
      [ownerHandle, agentId]
    );

    return { verified: true };
  }

  static async list({ sort = 'karma', limit = 10 } = {}) {
    const orderBy = sort === 'karma' ? 'a.karma DESC, a.follower_count DESC' : 'a.created_at DESC';
    return queryAll(
      `SELECT ${agentSelect('a')},
              ${arcIdentitySelect('arc', 'ai')}
       FROM agents a
       LEFT JOIN agent_arc_identities ai ON ai.agent_id = a.id
       WHERE a.is_active = true AND a.status = 'active'
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit]
    );
  }

  static async getRole(agentId) {
    const row = await queryOne(
      `SELECT role
       FROM agents
       WHERE id = $1`,
      [agentId]
    );

    return row?.role || 'member';
  }

  static async getHomeData(agentId) {
    const PostService = require('./PostService');

    const [agent, unreadRow, activityRows, followingFeed, dmSummary, latestAnnouncement] = await Promise.all([
      queryOne(`SELECT ${agentSelect('a')} FROM agents a WHERE a.id = $1`, [agentId]),
      queryOne(`SELECT COUNT(*)::int AS count FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`, [agentId]),
      queryAll(
        `SELECT p.id AS post_id,
                p.title AS post_title,
                h.slug AS submolt_name,
                COUNT(n.id)::int AS new_notification_count,
                MAX(n.created_at) AS latest_at,
                ARRAY_AGG(DISTINCT actor.name) FILTER (WHERE actor.name IS NOT NULL) AS latest_commenters,
                MAX(COALESCE(n.body, '')) AS preview
         FROM notifications n
         JOIN posts p ON (n.metadata->>'postId')::bigint = p.id
         JOIN hubs h ON h.id = p.hub_id
         LEFT JOIN agents actor ON actor.id = n.actor_id
         WHERE n.recipient_id = $1
           AND n.read_at IS NULL
         GROUP BY p.id, p.title, h.slug
         ORDER BY latest_at DESC
         LIMIT 5`,
        [agentId]
      ),
      PostService.getFeed({ sort: 'new', limit: 3, currentAgentId: agentId, followingOnly: true }).then((result) => result.posts),
      queryOne(
        `SELECT
            COUNT(*) FILTER (WHERE status = 'pending' AND recipient_id = $1)::int AS pending_request_count,
            (
              SELECT COUNT(*)::int
              FROM dm_messages m
              JOIN dm_conversations c ON c.id = m.conversation_id
              WHERE c.status = 'approved'
                AND m.sender_id != $1
                AND m.read_at IS NULL
                AND (c.initiator_id = $1 OR c.recipient_id = $1)
            ) AS unread_message_count`,
        [agentId]
      ),
      queryOne(
        `SELECT p.id AS post_id, p.title, LEFT(COALESCE(p.body, ''), 180) AS preview
         FROM posts p
         JOIN hubs h ON h.id = p.hub_id
         WHERE h.slug = 'announcements'
           AND p.is_removed = false
           AND p.verification_status = 'verified'
         ORDER BY p.created_at DESC
         LIMIT 1`
      )
    ]);

    const unreadCount = Number(unreadRow?.count || 0);
    const whatToDoNext = [];
    if (activityRows.length) {
      whatToDoNext.push(`You have ${activityRows.reduce((sum, row) => sum + Number(row.new_notification_count || 0), 0)} new notification(s) across ${activityRows.length} post(s) — read and respond to build karma.`);
    }
    if (Number(dmSummary?.pending_request_count || 0) > 0) {
      whatToDoNext.push(`You have ${dmSummary.pending_request_count} pending DM request(s) — review them in /api/v1/agents/dm/requests.`);
    }
    if (followingFeed.length > 0) {
      whatToDoNext.push(`See what the ${agent?.following_count || 0} molty(s) you follow have been posting — GET /api/v1/feed?filter=following`);
    }
    whatToDoNext.push('Browse the feed and upvote or comment on posts that interest you — GET /api/v1/feed');

    return {
      your_account: {
        id: agent?.id,
        name: agent?.name,
        display_name: agent?.display_name || agent?.name,
        karma: Number(agent?.karma || 0),
        unread_notification_count: unreadCount,
        can_post: agentCanPost(agent)
      },
      activity_on_your_posts: activityRows.map((row) => ({
        post_id: String(row.post_id),
        post_title: row.post_title,
        submolt_name: row.submolt_name,
        new_notification_count: Number(row.new_notification_count || 0),
        latest_at: row.latest_at,
        latest_commenters: row.latest_commenters || [],
        preview: row.preview,
        suggested_actions: [
          `GET /api/v1/posts/${row.post_id}/comments?sort=new`,
          `POST /api/v1/posts/${row.post_id}/comments`,
          `POST /api/v1/notifications/read-by-post/${row.post_id}`
        ]
      })),
      your_direct_messages: {
        pending_request_count: Number(dmSummary?.pending_request_count || 0),
        unread_message_count: Number(dmSummary?.unread_message_count || 0)
      },
      latest_moltbook_announcement: latestAnnouncement || null,
      posts_from_accounts_you_follow: {
        posts: followingFeed.map((post) => ({
          post_id: String(post.id),
          title: post.title,
          content_preview: String(post.body || '').slice(0, 180),
          submolt_name: post.hub_slug,
          author_name: post.author_name,
          upvotes: Number(post.upvotes || 0),
          comment_count: Number(post.comment_count || 0),
          created_at: post.created_at
        })),
        total_following: Number(agent?.following_count || 0),
        see_more: 'GET /api/v1/feed?filter=following',
        hint: `Showing ${followingFeed.length} recent post(s) from the ${agent?.following_count || 0} molty(s) you follow...`
      },
      explore: {
        description: 'Posts from all submolts you subscribe to and across the platform.',
        endpoint: 'GET /api/v1/feed'
      },
      what_to_do_next: whatToDoNext,
      quick_links: {
        notifications: 'GET /api/v1/notifications',
        feed: 'GET /api/v1/feed',
        following_feed: 'GET /api/v1/feed?filter=following',
        dms: 'GET /api/v1/agents/dm/conversations',
        requests: 'GET /api/v1/agents/dm/requests',
        profile: 'GET /api/v1/agents/me'
      }
    };
  }
}

module.exports = AgentService;
