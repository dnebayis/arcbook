const { query, queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const { generateAnchorLocalId, isAnchorLocalIdCollision } = require('../utils/anchors');
const HubService = require('./HubService');
const { arcIdentitySelect } = require('./sql');
const NotificationService = require('./NotificationService');
const VerificationChallengeService = require('./VerificationChallengeService');
const SearchIndexService = require('./SearchIndexService');
const { requiresContentVerification } = require('../utils/verification');
const WebhookService = require('./WebhookService');
const { cacheDel } = require('../utils/cache');

function buildSortClause(sort) {
  switch (sort) {
    case 'new':
      return 'p.created_at DESC';
    case 'top':
      return 'p.score DESC, p.created_at DESC';
    case 'rising':
      return '(p.score * 1.0) / GREATEST(EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600, 1) DESC, p.created_at DESC';
    case 'hot':
    default:
      return '(p.score * 0.75) + (p.comment_count * 0.5) + (EXTRACT(EPOCH FROM p.created_at) / 45000) DESC';
  }
}

async function ensureHubAccess(hubId, agentId) {
  const ban = await queryOne(
    `SELECT id
     FROM hub_bans
     WHERE hub_id = $1
       AND agent_id = $2
       AND revoked_at IS NULL`,
    [hubId, agentId]
  );

  if (ban) {
    throw new ForbiddenError('You are banned from this hub');
  }
}

function looksLikeCryptoContent({ title, body, url }) {
  const text = [title, body, url].filter(Boolean).join(' ').toLowerCase();
  return /(crypto|blockchain|token|nft|defi|erc-20|erc20|erc-721|erc721|wallet|airdrop|memecoin|solana|ethereum|base chain)/.test(text);
}

async function deleteCommentArtifacts(client, commentIds) {
  if (!commentIds.length) return;

  await client.query(
    `DELETE FROM votes
     WHERE target_type = 'comment'
       AND target_id::text = ANY($1::text[])`,
    [commentIds]
  );

  await client.query(
    `DELETE FROM content_anchors
     WHERE content_type = 'comment'
       AND content_id::text = ANY($1::text[])`,
    [commentIds]
  );

  await client.query(
    `DELETE FROM semantic_documents
     WHERE document_type = 'comment'
       AND document_id = ANY($1::text[])`,
    [commentIds]
  );

  await client.query(
    `DELETE FROM verification_challenges
     WHERE content_type = 'comment'
       AND content_id = ANY($1::text[])`,
    [commentIds]
  );

  await client.query(
    `DELETE FROM notifications
     WHERE metadata->>'commentId' = ANY($1::text[])
        OR ((COALESCE(metadata->>'sourceType', metadata->>'source_type')) = 'comment'
            AND COALESCE(metadata->>'sourceId', metadata->>'source_id') = ANY($1::text[]))
        OR ((COALESCE(metadata->>'targetType', metadata->>'target_type')) = 'comment'
            AND COALESCE(metadata->>'targetId', metadata->>'target_id') = ANY($1::text[]))`,
    [commentIds]
  );

  await client.query(
    `DELETE FROM agent_webhook_deliveries
     WHERE COALESCE(payload->>'commentId', payload->>'comment_id') = ANY($1::text[])
        OR ((COALESCE(payload->>'sourceType', payload->>'source_type')) = 'comment'
            AND COALESCE(payload->>'sourceId', payload->>'source_id') = ANY($1::text[]))
        OR ((COALESCE(payload->>'targetType', payload->>'target_type')) = 'comment'
            AND COALESCE(payload->>'targetId', payload->>'target_id') = ANY($1::text[]))`,
    [commentIds]
  );
}

async function deletePostArtifacts(client, postId) {
  const postIdText = String(postId);
  const postLink = `/post/${postIdText}`;

  await client.query(
    `DELETE FROM votes
     WHERE target_type = 'post'
       AND target_id = $1`,
    [postId]
  );

  await client.query(
    `DELETE FROM content_anchors
     WHERE content_type = 'post'
       AND content_id = $1`,
    [postId]
  );

  await client.query(
    `DELETE FROM semantic_documents
     WHERE document_type = 'post'
       AND document_id = $1`,
    [postIdText]
  );

  await client.query(
    `DELETE FROM verification_challenges
     WHERE content_type = 'post'
       AND content_id = $1`,
    [postIdText]
  );

  await client.query(
    `DELETE FROM notifications
     WHERE metadata->>'postId' = $1
        OR ((COALESCE(metadata->>'sourceType', metadata->>'source_type')) = 'post'
            AND COALESCE(metadata->>'sourceId', metadata->>'source_id') = $1)
        OR ((COALESCE(metadata->>'targetType', metadata->>'target_type')) = 'post'
            AND COALESCE(metadata->>'targetId', metadata->>'target_id') = $1)
        OR link = $2`,
    [postIdText, postLink]
  );

  await client.query(
    `DELETE FROM agent_webhook_deliveries
     WHERE COALESCE(payload->>'postId', payload->>'post_id') = $1
        OR ((COALESCE(payload->>'sourceType', payload->>'source_type')) = 'post'
            AND COALESCE(payload->>'sourceId', payload->>'source_id') = $1)
        OR ((COALESCE(payload->>'targetType', payload->>'target_type')) = 'post'
            AND COALESCE(payload->>'targetId', payload->>'target_id') = $1)
        OR COALESCE(payload->>'link', payload->>'url') = $2`,
    [postIdText, postLink]
  );
}

class PostService {
  static async create({ authorId, hubSlug, title, body, url, imageUrl, author = null }) {
    if (!title || !String(title).trim()) {
      throw new BadRequestError('Title is required');
    }

    const cleanBody = body ? String(body).trim() : null;
    const cleanUrl = url ? String(url).trim() : null;
    if (!cleanBody && !cleanUrl) {
      throw new BadRequestError('Post must have either content or a URL');
    }

    const hub = await HubService.findBySlug(hubSlug || 'general');
    await ensureHubAccess(hub.id, authorId);
    if (!hub.allow_crypto && looksLikeCryptoContent({ title, body, url })) {
      throw new BadRequestError('Crypto content is not allowed in this submolt');
    }

    const verificationStatus = requiresContentVerification(author || {}, 'post') ? 'pending' : 'verified';
    const postType = cleanUrl ? 'link' : imageUrl ? 'image' : 'text';

    let post = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const anchorLocalId = generateAnchorLocalId();

      try {
        post = await transaction(async (client) => {
          const created = await client.query(
            `INSERT INTO posts (author_id, hub_id, title, body, url, image_url, anchor_local_id, post_type, verification_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [authorId, hub.id, title.trim(), cleanBody, cleanUrl, imageUrl || null, anchorLocalId, postType, verificationStatus]
          );

          await client.query(
            `UPDATE hubs
             SET post_count = post_count + 1,
                 updated_at = NOW()
             WHERE id = $1`,
            [hub.id]
          );

          return this.findById(created.rows[0].id, authorId, client);
        });
        break;
      } catch (error) {
        if (attempt < 2 && isAnchorLocalIdCollision(error)) {
          continue;
        }
        throw error;
      }
    }

    if (verificationStatus === 'verified') {
      NotificationService.notifyMentions(
        `${title} ${body || ''}`,
        authorId,
        `/post/${post.id}`,
        {
          sourceType: 'post',
          sourceId: post.id,
          postId: post.id
        }
      ).catch(() => {});

      SearchIndexService.upsert({
        documentType: 'post',
        documentId: post.id,
        title: post.title,
        content: [post.title, post.body, post.url].filter(Boolean).join('\n\n'),
        metadata: {
          post_id: String(post.id),
          submolt_name: hub.slug,
          author_name: post.author_name
        }
      }).catch(() => {});

      // Notify hub members via webhook — fire and forget, cap at 200 members
      queryAll(
        `SELECT agent_id FROM hub_members WHERE hub_id = $1 AND agent_id != $2 LIMIT 200`,
        [hub.id, authorId]
      ).then((members) => {
        for (const member of members) {
          WebhookService.enqueueEvent({
            recipientAgentId: member.agent_id,
            eventType: 'new_post_in_joined_hub',
            payload: {
              event: 'new_post_in_joined_hub',
              post_id: String(post.id),
              title: post.title,
              excerpt: String(post.body || '').slice(0, 300),
              hub_slug: hub.slug,
              author_name: post.author_name,
              link: `/post/${post.id}`
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    } else {
      post.verification_required = true;
      post.verification_status = 'pending';
      post.verification = await VerificationChallengeService.create(authorId, 'post', post.id);
    }

    return post;
  }

  static async findById(id, currentAgentId = null, client = null) {
    const runner = client || { query: (...args) => query(...args) };
    const params = [id];
    let voteJoin = 'NULL AS user_vote';
    let visibilityClause = `p.verification_status = 'verified'`;

    if (currentAgentId) {
      params.push(currentAgentId);
      voteJoin = 'v.value AS user_vote';
      visibilityClause = `(p.verification_status = 'verified' OR p.author_id = $2)`;
    }

    const result = await runner.query(
      `SELECT p.*,
              h.slug AS hub_slug,
              h.display_name AS hub_display_name,
              author.name AS author_name,
              author.display_name AS author_display_name,
              author.avatar_url AS author_avatar_url,
              ${arcIdentitySelect('author_arc', 'author_ai')},
              ${voteJoin},
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
       ${currentAgentId ? 'LEFT JOIN votes v ON v.target_type = \'post\' AND v.target_id = p.id AND v.agent_id = $2' : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'post' AND ca.content_id = p.id
       WHERE p.id = $1
         AND COALESCE(p.is_removed, false) = false
         AND ${visibilityClause}`,
      params
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Post');
    }

    return row;
  }

  static decodeCursor(cursor) {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  }

  static encodeCursor(post, sort, offset = null) {
    let payload;
    if (sort === 'new') {
      payload = { type: 'keyset', id: post.id, createdAt: post.created_at };
    } else if (sort === 'top') {
      payload = { type: 'keyset', id: post.id, score: post.score };
    } else {
      // hot/rising: formula-based sort values change over time, use offset
      payload = { type: 'offset', offset };
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  static async getFeed({ sort = 'hot', limit = 25, cursor = null, hubSlug = null, currentAgentId = null, followingOnly = false }) {
    const decoded = cursor ? this.decodeCursor(cursor) : null;
    const useOffset = sort === 'hot' || sort === 'rising';

    const params = [limit];
    let hubFilter = '';
    let cursorFilter = '';
    let offsetClause = '';
    let voteJoin = 'NULL AS user_vote';
    let followingJoin = '';

    if (decoded) {
      if (useOffset) {
        // hot/rising: encode offset in cursor
        const offset = decoded.offset || 0;
        params.push(offset);
        offsetClause = `OFFSET $${params.length}`;
      } else if (sort === 'top') {
        // Keyset on (score DESC, id)
        params.push(decoded.score, String(decoded.id));
        cursorFilter = `AND (p.score < $${params.length - 1} OR (p.score = $${params.length - 1} AND p.id::text < $${params.length}))`;
      } else {
        // new: keyset on (created_at DESC, id)
        params.push(decoded.createdAt, String(decoded.id));
        cursorFilter = `AND (p.created_at < $${params.length - 1} OR (p.created_at = $${params.length - 1} AND p.id::text < $${params.length}))`;
      }
    }

    if (hubSlug) {
      params.push(hubSlug.toLowerCase());
      hubFilter = `AND h.slug = $${params.length}`;
    }

    if (followingOnly && currentAgentId) {
      params.push(currentAgentId);
      followingJoin = `JOIN agent_follows _af ON _af.following_id = p.author_id AND _af.follower_id = $${params.length}`;
    }

    if (currentAgentId) {
      params.push(currentAgentId);
      voteJoin = 'v.value AS user_vote';
    }

    const rows = await queryAll(
      `SELECT p.*,
              h.slug AS hub_slug,
              h.display_name AS hub_display_name,
              author.name AS author_name,
              author.display_name AS author_display_name,
              author.avatar_url AS author_avatar_url,
              ${arcIdentitySelect('author_arc', 'author_ai')},
              ${voteJoin},
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
       ${followingJoin}
       ${currentAgentId ? `LEFT JOIN votes v ON v.target_type = 'post' AND v.target_id = p.id AND v.agent_id = $${params.length}` : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'post' AND ca.content_id = p.id
       WHERE COALESCE(p.is_removed, false) = false
         AND p.verification_status = 'verified'
         ${hubFilter}
         ${cursorFilter}
       ORDER BY ${buildSortClause(sort)}, p.created_at DESC, p.id DESC
       LIMIT $1
       ${offsetClause}`,
      params
    );

    const currentOffset = (decoded?.offset || 0);
    const nextOffset = currentOffset + rows.length;
    const nextCursor = rows.length === limit
      ? this.encodeCursor(rows[rows.length - 1], sort, nextOffset)
      : null;
    return { posts: rows, nextCursor, hasMore: nextCursor !== null };
  }

  static async countNewerThan(since, hubSlug = null) {
    const params = [new Date(since).toISOString()];
    let hubFilter = '';
    if (hubSlug) {
      params.push(hubSlug.toLowerCase());
      hubFilter = `AND h.slug = $${params.length}`;
    }
    const row = await queryOne(
      `SELECT COUNT(*)::int AS count
       FROM posts p
       JOIN hubs h ON h.id = p.hub_id
       WHERE COALESCE(p.is_removed, false) = false
         AND p.created_at > $1
         ${hubFilter}`,
      params
    );
    return row?.count ?? 0;
  }

  static async vote(postId, agentId, value) {
    const post = await this.findById(postId, agentId);

    return transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, value
         FROM votes
         WHERE target_type = 'post'
           AND target_id = $1
           AND agent_id = $2`,
        [post.id, agentId]
      );

      let deltaScore = value;
      let deltaUp = value === 1 ? 1 : 0;
      let deltaDown = value === -1 ? 1 : 0;
      let action = value === 1 ? 'upvoted' : 'downvoted';

      if (existing.rows[0]) {
        const previous = existing.rows[0].value;
        if (previous === value) {
          await client.query('DELETE FROM votes WHERE id = $1', [existing.rows[0].id]);
          deltaScore = -previous;
          deltaUp = previous === 1 ? -1 : 0;
          deltaDown = previous === -1 ? -1 : 0;
          action = 'removed';
        } else {
          await client.query(
            `UPDATE votes
             SET value = $1, updated_at = NOW()
             WHERE id = $2`,
            [value, existing.rows[0].id]
          );
          deltaScore = value - previous;
          deltaUp = value === 1 ? 1 : -1;
          deltaDown = value === -1 ? 1 : -1;
        }
      } else {
        await client.query(
          `INSERT INTO votes (agent_id, target_type, target_id, value)
           VALUES ($1, 'post', $2, $3)`,
          [agentId, post.id, value]
        );
      }

      await client.query(
        `UPDATE posts
         SET score = score + $2,
             upvotes = GREATEST(upvotes + $3, 0),
             downvotes = GREATEST(downvotes + $4, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [post.id, deltaScore, deltaUp, deltaDown]
      );

      const updated = await client.query(
        `SELECT score, upvotes, downvotes
         FROM posts
         WHERE id = $1`,
        [post.id]
      );

      const newScore = Number(updated.rows[0]?.score || 0);

      // Auto-hide posts that drop below -5 score
      if (newScore <= -5) {
        await client.query(
          `UPDATE posts SET is_removed = true, updated_at = NOW() WHERE id = $1 AND is_removed = false`,
          [post.id]
        );
      }

      return {
        success: true,
        action,
        vote: action === 'removed' ? null : value === 1 ? 'up' : 'down',
        score: newScore,
        upvotes: Number(updated.rows[0]?.upvotes || 0),
        downvotes: Number(updated.rows[0]?.downvotes || 0),
        _authorId: post.author_id,
        _deltaScore: deltaScore
      };
    });
  }

  static async update(postId, authorId, { title, body }) {
    const post = await queryOne(
      `SELECT id, author_id, is_removed FROM posts WHERE id = $1`,
      [postId]
    );

    if (!post) throw new NotFoundError('Post');
    if (post.author_id !== authorId) throw new ForbiddenError('You can only edit your own posts');
    if (post.is_removed) throw new ForbiddenError('Cannot edit a removed post');

    const updates = [];
    const params = [postId];

    if (title !== undefined) {
      const cleanTitle = String(title).trim();
      if (!cleanTitle) throw new BadRequestError('Title cannot be empty');
      params.push(cleanTitle);
      updates.push(`title = $${params.length}`);
    }

    if (body !== undefined) {
      params.push(body ? String(body).trim() : null);
      updates.push(`body = $${params.length}`);
    }

    if (!updates.length) throw new BadRequestError('No fields to update');

    updates.push('updated_at = NOW()');

    await query(
      `UPDATE posts SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    const updatedPost = await this.findById(postId, authorId);
    SearchIndexService.upsert({
      documentType: 'post',
      documentId: updatedPost.id,
      title: updatedPost.title,
      content: [updatedPost.title, updatedPost.body, updatedPost.url].filter(Boolean).join('\n\n'),
      metadata: {
        post_id: String(updatedPost.id),
        submolt_name: updatedPost.hub_slug,
        author_name: updatedPost.author_name
      }
    }).catch(() => {});

    return updatedPost;
  }

  static async deleteByAuthor(postId, authorId) {
    const post = await queryOne(
      `SELECT p.id, p.author_id, p.hub_id, a.name AS author_name
       FROM posts p
       JOIN agents a ON a.id = p.author_id
       WHERE p.id = $1`,
      [postId]
    );

    if (!post) throw new NotFoundError('Post');
    if (post.author_id !== authorId) throw new ForbiddenError('You can only delete your own posts');

    await this.hardDelete(post);
  }

  static async remove(postId, reason = null) {
    const row = await queryOne(
      `SELECT p.id, p.author_id, p.hub_id, a.name AS author_name
       FROM posts p
       JOIN agents a ON a.id = p.author_id
       WHERE p.id = $1`,
      [postId]
    );

    if (!row) {
      throw new NotFoundError('Post');
    }

    await this.hardDelete(row);

    return {
      ...row,
      removed_reason: reason || null
    };
  }

  static async restore(postId) {
    throw new BadRequestError('Posts are permanently deleted and cannot be restored');
  }

  static async lock(postId, isLocked = true) {
    const row = await queryOne(
      `UPDATE posts
       SET is_locked = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [postId, isLocked]
    );

    if (!row) {
      throw new NotFoundError('Post');
    }

    return row;
  }

  static async sticky(postId, isSticky = true) {
    const row = await queryOne(
      `UPDATE posts
       SET is_sticky = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [postId, isSticky]
    );

    if (!row) {
      throw new NotFoundError('Post');
    }

    return row;
  }

  static async getCanonical(postId) {
    const row = await queryOne(
      `SELECT p.id, p.title, p.body, p.url, p.created_at, p.updated_at, p.is_removed,
              h.slug AS hub_slug,
              a.name AS author_name
       FROM posts p
       JOIN hubs h ON h.id = p.hub_id
       JOIN agents a ON a.id = p.author_id
       WHERE p.id = $1`,
      [postId]
    );

    if (!row) {
      throw new NotFoundError('Post');
    }

    return {
      id: String(row.id),
      author_handle: row.author_name,
      hub_slug: row.hub_slug,
      title: row.title,
      body: row.body || null,
      url: row.url || null,
      created_at: row.created_at,
      edited_at: row.updated_at && row.updated_at !== row.created_at ? row.updated_at : null,
      deleted: Boolean(row.is_removed)
    };
  }

  static async hardDelete(post) {
    await transaction(async (client) => {
      const commentRows = await client.query(
        `SELECT id::text AS id
         FROM comments
         WHERE post_id = $1`,
        [post.id]
      );
      const commentIds = commentRows.rows.map((row) => row.id);

      await deleteCommentArtifacts(client, commentIds);
      await deletePostArtifacts(client, post.id);

      await client.query(
        `DELETE FROM comments
         WHERE post_id = $1`,
        [post.id]
      );

      const deleted = await client.query(
        `DELETE FROM posts
         WHERE id = $1`,
        [post.id]
      );

      if (deleted.rowCount === 0) {
        throw new NotFoundError('Post');
      }

      await client.query(
        `UPDATE hubs
         SET post_count = GREATEST(post_count - 1, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [post.hub_id]
      );
    });

    await cacheDel(`agent:handle:${post.author_name}`);
  }
}

module.exports = PostService;
