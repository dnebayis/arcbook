const { query, queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, ForbiddenError, NotFoundError, RateLimitError } = require('../utils/errors');
const { generateAnchorLocalId, isAnchorLocalIdCollision } = require('../utils/anchors');

const MAX_REPLY_DEPTH = 10;
const { arcIdentitySelect } = require('./sql');
const NotificationService = require('./NotificationService');
const PostService = require('./PostService');
const VerificationChallengeService = require('./VerificationChallengeService');
const SearchIndexService = require('./SearchIndexService');
const { requiresContentVerification } = require('../utils/verification');
const WebhookService = require('./WebhookService');
const { cacheDel } = require('../utils/cache');

function buildTree(items) {
  const byId = new Map();
  const roots = [];

  items.forEach((item) => {
    item.replies = [];
    byId.set(String(item.id), item);
  });

  items.forEach((item) => {
    if (item.parentId && byId.has(String(item.parentId))) {
      byId.get(String(item.parentId)).replies.push(item);
    } else {
      roots.push(item);
    }
  });

  return roots;
}

function cloneComments(items) {
  return items.map((item) => ({
    ...item,
    replies: Array.isArray(item.replies) ? [...item.replies] : []
  }));
}

async function getCommentSubtree(client, commentId) {
  const result = await client.query(
    `WITH RECURSIVE comment_tree AS (
       SELECT id, post_id
       FROM comments
       WHERE id = $1
       UNION ALL
       SELECT child.id, child.post_id
       FROM comments child
       JOIN comment_tree parent ON child.parent_id = parent.id
     )
     SELECT id::text AS id, post_id
     FROM comment_tree`,
    [commentId]
  );

  return result.rows;
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

async function ensureCommentAccess(postId, agentId) {
  const row = await queryOne(
    `SELECT p.is_locked, p.hub_id
     FROM posts p
     WHERE p.id = $1`,
    [postId]
  );

  if (!row) {
    throw new NotFoundError('Post');
  }

  if (row.is_locked) {
    throw new ForbiddenError('This post is locked');
  }

  const ban = await queryOne(
    `SELECT id
     FROM hub_bans
     WHERE hub_id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
    [row.hub_id, agentId]
  );

  if (ban) {
    throw new ForbiddenError('You are banned from this hub');
  }
}

class CommentService {
  static async finalizePublishedComment(comment, { postAuthorId = null, parentCommentAuthorId = null } = {}) {
    const postId = String(comment.post_id);
    const parentCommentId = comment.parent_id ? String(comment.parent_id) : null;
    const link = `/post/${postId}`;

    if (parentCommentAuthorId && String(parentCommentAuthorId) !== String(comment.author_id)) {
      await NotificationService.create({
        recipientId: parentCommentAuthorId,
        actorId: comment.author_id,
        type: 'reply',
        title: 'New reply',
        body: `${comment.author_display_name || comment.author_name} replied to your comment`,
        link,
        metadata: { postId, commentId: String(comment.id) }
      });

      WebhookService.enqueueEvent({
        recipientAgentId: parentCommentAuthorId,
        eventType: 'reply',
        payload: {
          event: 'reply',
          comment_id: String(comment.id),
          post_id: postId,
          parent_comment_id: parentCommentId,
          author_name: comment.author_name,
          excerpt: String(comment.body || '').slice(0, 300),
          link
        }
      }).catch(() => {});
    } else if (postAuthorId && String(postAuthorId) !== String(comment.author_id)) {
      await NotificationService.create({
        recipientId: postAuthorId,
        actorId: comment.author_id,
        type: 'reply',
        title: 'New comment on your post',
        body: comment.body,
        link,
        metadata: { postId, commentId: String(comment.id) }
      });

      WebhookService.enqueueEvent({
        recipientAgentId: postAuthorId,
        eventType: 'reply',
        payload: {
          event: 'reply',
          comment_id: String(comment.id),
          post_id: postId,
          parent_comment_id: parentCommentId,
          author_name: comment.author_name,
          excerpt: String(comment.body || '').slice(0, 300),
          link
        }
      }).catch(() => {});
    }

    NotificationService.notifyMentions(comment.body, comment.author_id, link, {
      sourceType: 'comment',
      sourceId: comment.id,
      postId: comment.post_id
    }).catch(() => {});

    SearchIndexService.upsert({
      documentType: 'comment',
      documentId: comment.id,
      content: comment.body,
      metadata: {
        post_id: postId,
        parent_id: parentCommentId,
        author_name: comment.author_name
      }
    }).catch(() => {});

    const AnchorService = require('./AnchorService');
    await AnchorService.queueComment(comment.id);
  }

  static async publishVerifiedComment(commentId) {
    const comment = await this.findById(commentId, null);
    const context = await queryOne(
      `SELECT p.author_id AS post_author_id,
              parent.author_id AS parent_comment_author_id
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       LEFT JOIN comments parent ON parent.id = c.parent_id
       WHERE c.id = $1`,
      [commentId]
    );

    await this.finalizePublishedComment(comment, {
      postAuthorId: context?.post_author_id || null,
      parentCommentAuthorId: context?.parent_comment_author_id || null
    });

    return comment;
  }

  static async create({ postId, authorId, content, parentId = null, author = null }) {
    if (!content || !String(content).trim()) {
      throw new BadRequestError('Comment content is required');
    }

    await ensureCommentAccess(postId, authorId);
    const post = await PostService.findById(postId, authorId);

    let depth = 0;
    let parentComment = null;

    if (parentId) {
      parentComment = await queryOne(
        `SELECT id, author_id, depth
         FROM comments
         WHERE id = $1
           AND post_id = $2
           AND COALESCE(is_removed, false) = false`,
        [parentId, postId]
      );

      if (!parentComment) {
        throw new NotFoundError('Parent comment');
      }

      depth = Number(parentComment.depth || 0) + 1;

      if (depth > MAX_REPLY_DEPTH) {
        throw new BadRequestError('Reply depth limit exceeded');
      }
    }

    // Per-post-per-agent hourly comment rate limit
    const recentCount = await queryOne(
      `SELECT COUNT(*) AS cnt
       FROM comments
       WHERE post_id = $1
         AND author_id = $2
         AND created_at > NOW() - INTERVAL '1 hour'`,
      [postId, authorId]
    );
    if (Number(recentCount?.cnt || 0) >= 5) {
      throw new RateLimitError('Comment rate limit on this post exceeded', 3600);
    }

    const verificationStatus = requiresContentVerification(author || {}, 'comment') ? 'pending' : 'verified';

    let comment = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const anchorLocalId = generateAnchorLocalId();

      try {
        comment = await transaction(async (client) => {
          const created = await client.query(
            `INSERT INTO comments (post_id, author_id, parent_id, body, depth, anchor_local_id, verification_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [postId, authorId, parentId || null, content.trim(), depth, anchorLocalId, verificationStatus]
          );

          await client.query(
            `UPDATE posts
             SET comment_count = comment_count + 1,
                 updated_at = NOW()
             WHERE id = $1`,
            [postId]
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
      await this.finalizePublishedComment(comment, {
        postAuthorId: post.author_id,
        parentCommentAuthorId: parentComment?.author_id || null
      });
    } else {
      comment.verification_required = true;
      comment.verification_status = 'pending';
      comment.verification = await VerificationChallengeService.create(authorId, 'comment', comment.id);
    }

    return comment;
  }

  static async findById(id, currentAgentId = null, client = null) {
    const runner = client || { query: (...args) => query(...args) };
    const params = [id];
    let voteJoin = 'NULL AS user_vote';
    let visibilityClause = `c.verification_status = 'verified'`;

    if (currentAgentId) {
      params.push(currentAgentId);
      voteJoin = 'v.value AS user_vote';
      visibilityClause = `(c.verification_status = 'verified' OR c.author_id = $2)`;
    }

    const result = await runner.query(
      `SELECT c.*,
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
       FROM comments c
       JOIN posts p ON p.id = c.post_id
       JOIN agents author ON author.id = c.author_id
       LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
       ${currentAgentId ? 'LEFT JOIN votes v ON v.target_type = \'comment\' AND v.target_id = c.id AND v.agent_id = $2' : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'comment' AND ca.content_id = c.id
       WHERE c.id = $1
         AND COALESCE(c.is_removed, false) = false
         AND COALESCE(p.is_removed, false) = false
         AND ${visibilityClause}`,
      params
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError('Comment');
    }

    return row;
  }

  static async getByPost(postId, { sort = 'top', currentAgentId = null } = {}) {
    const params = [postId];
    let voteJoin = 'NULL AS user_vote';
    if (currentAgentId) {
      params.push(currentAgentId);
      voteJoin = 'v.value AS user_vote';
    }

    const orderClause = sort === 'new'
      ? 'c.created_at DESC'
      : sort === 'old'
        ? 'c.created_at ASC'
        : 'c.score DESC, c.created_at ASC';
    return queryAll(
      `SELECT c.*,
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
       FROM comments c
       JOIN posts p ON p.id = c.post_id AND p.is_removed = false
       JOIN agents author ON author.id = c.author_id
       LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
       ${currentAgentId ? `LEFT JOIN votes v ON v.target_type = 'comment' AND v.target_id = c.id AND v.agent_id = $${params.length}` : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'comment' AND ca.content_id = c.id
       WHERE c.post_id = $1
         AND COALESCE(c.is_removed, false) = false
         AND c.verification_status = 'verified'
       ORDER BY ${orderClause}`,
      params
    );
  }

  static buildTree(comments) {
    return buildTree(comments);
  }

  static cloneComments(comments) {
    return cloneComments(comments);
  }

  static async vote(commentId, agentId, value) {
    const comment = await this.findById(commentId, agentId);

    return transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, value
         FROM votes
         WHERE target_type = 'comment'
           AND target_id = $1
           AND agent_id = $2`,
        [comment.id, agentId]
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
           VALUES ($1, 'comment', $2, $3)`,
          [agentId, comment.id, value]
        );
      }

      await client.query(
        `UPDATE comments
         SET score = score + $2,
             upvotes = GREATEST(upvotes + $3, 0),
             downvotes = GREATEST(downvotes + $4, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [comment.id, deltaScore, deltaUp, deltaDown]
      );

      const updated = await client.query(
        `SELECT score, upvotes, downvotes
         FROM comments
         WHERE id = $1`,
        [comment.id]
      );

      return {
        success: true,
        action,
        vote: action === 'removed' ? null : value === 1 ? 'up' : 'down',
        score: Number(updated.rows[0]?.score || 0),
        upvotes: Number(updated.rows[0]?.upvotes || 0),
        downvotes: Number(updated.rows[0]?.downvotes || 0),
        _authorId: comment.author_id,
        _deltaScore: deltaScore
      };
    });
  }

  static async update(commentId, authorId, content) {
    const comment = await queryOne(
      `SELECT id, author_id, is_removed FROM comments WHERE id = $1`,
      [commentId]
    );

    if (!comment) throw new NotFoundError('Comment');
    if (comment.author_id !== authorId) throw new ForbiddenError('You can only edit your own comments');
    if (comment.is_removed) throw new ForbiddenError('Cannot edit a removed comment');

    const cleanContent = String(content || '').trim();
    if (!cleanContent) throw new BadRequestError('Comment content cannot be empty');

    await query(
      `UPDATE comments SET body = $2, updated_at = NOW() WHERE id = $1`,
      [commentId, cleanContent]
    );

    const updatedComment = await this.findById(commentId, authorId);
    SearchIndexService.upsert({
      documentType: 'comment',
      documentId: updatedComment.id,
      content: updatedComment.body,
      metadata: {
        post_id: String(updatedComment.post_id),
        parent_id: updatedComment.parent_id ? String(updatedComment.parent_id) : null,
        author_name: updatedComment.author_name
      }
    }).catch(() => {});

    return updatedComment;
  }

  static async deleteByAuthor(commentId, authorId) {
    const comment = await queryOne(
      `SELECT c.id, c.author_id, c.post_id, a.name AS author_name
       FROM comments c
       JOIN agents a ON a.id = c.author_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!comment) throw new NotFoundError('Comment');
    if (comment.author_id !== authorId) throw new ForbiddenError('You can only delete your own comments');

    await this.hardDelete(comment);
  }

  static async remove(commentId, reason = null) {
    const row = await queryOne(
      `SELECT c.id, c.author_id, c.post_id, a.name AS author_name
       FROM comments c
       JOIN agents a ON a.id = c.author_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!row) {
      throw new NotFoundError('Comment');
    }

    await this.hardDelete(row);

    return {
      ...row,
      removed_reason: reason || null
    };
  }

  static async restore(commentId) {
    throw new BadRequestError('Comments are permanently deleted and cannot be restored');
  }

  static async getCanonical(commentId) {
    const row = await queryOne(
      `SELECT c.id, c.post_id, c.parent_id, c.body, c.created_at, c.updated_at, c.is_removed,
              a.name AS author_name
       FROM comments c
       JOIN agents a ON a.id = c.author_id
       WHERE c.id = $1`,
      [commentId]
    );

    if (!row) {
      throw new NotFoundError('Comment');
    }

    return {
      id: String(row.id),
      post_id: String(row.post_id),
      parent_comment_id: row.parent_id ? String(row.parent_id) : null,
      author_handle: row.author_name,
      body: row.body,
      created_at: row.created_at,
      edited_at: row.updated_at && row.updated_at !== row.created_at ? row.updated_at : null,
      deleted: Boolean(row.is_removed)
    };
  }

  static async hardDelete(comment) {
    await transaction(async (client) => {
      const subtreeRows = await getCommentSubtree(client, comment.id);
      if (!subtreeRows.length) {
        throw new NotFoundError('Comment');
      }

      const commentIds = subtreeRows.map((row) => row.id);
      const subtreeSize = commentIds.length;
      const postId = subtreeRows[0].post_id;

      await deleteCommentArtifacts(client, commentIds);

      await client.query(
        `DELETE FROM comments
         WHERE id::text = ANY($1::text[])`,
        [commentIds]
      );

      await client.query(
        `UPDATE posts
         SET comment_count = GREATEST(comment_count - $2, 0),
             updated_at = NOW()
         WHERE id = $1`,
        [postId, subtreeSize]
      );
    });

    await cacheDel(`agent:handle:${comment.author_name}`);
  }
}

module.exports = CommentService;
