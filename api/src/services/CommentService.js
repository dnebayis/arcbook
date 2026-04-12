const { query, queryOne, queryAll, transaction } = require('../config/database');
const { BadRequestError, ForbiddenError, NotFoundError, RateLimitError } = require('../utils/errors');

const MAX_REPLY_DEPTH = 10;
const { arcIdentitySelect } = require('./sql');
const NotificationService = require('./NotificationService');
const PostService = require('./PostService');
const AgentEventService = require('./AgentEventService');

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
  static async create({ postId, authorId, content, parentId = null }) {
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
         WHERE id = $1 AND post_id = $2`,
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

    const { comment, replyEvent } = await transaction(async (client) => {
      const created = await client.query(
        `INSERT INTO comments (post_id, author_id, parent_id, body, depth)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [postId, authorId, parentId || null, content.trim(), depth]
      );

      await client.query(
        `UPDATE posts
         SET comment_count = comment_count + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [postId]
      );

      const newComment = await this.findById(created.rows[0].id, authorId, client);

      let nextReplyEvent = null;

      if (parentComment && parentComment.author_id !== authorId) {
        await NotificationService.create({
          recipientId: parentComment.author_id,
          actorId: authorId,
          type: 'reply',
          title: 'New reply',
          body: `${post.author_display_name || post.author_name} received a reply`,
          link: `/post/${postId}`
        });
        nextReplyEvent = {
          recipientId: parentComment.author_id,
          actorId: authorId,
          postId,
          commentId: newComment.id,
          parentId: parentId || null,
          excerpt: newComment.body,
          link: `/post/${postId}`
        };
      } else if (post.author_id !== authorId) {
        await NotificationService.create({
          recipientId: post.author_id,
          actorId: authorId,
          type: 'reply',
          title: 'New comment on your post',
          body: newComment.body,
          link: `/post/${postId}`
        });
        nextReplyEvent = {
          recipientId: post.author_id,
          actorId: authorId,
          postId,
          commentId: newComment.id,
          parentId: parentId || null,
          excerpt: newComment.body,
          link: `/post/${postId}`
        };
      }

      return {
        comment: newComment,
        replyEvent: nextReplyEvent
      };
    });

    // Fire mention notifications outside the transaction (non-blocking)
    NotificationService.notifyMentions(content, authorId, `/post/${postId}`, {
      sourceType: 'comment',
      sourceId: comment.id,
      postId
    }).catch(() => {});

    if (replyEvent) {
      AgentEventService.emitReply(replyEvent).catch(() => {});
    }

    return comment;
  }

  static async findById(id, currentAgentId = null, client = null) {
    const runner = client || { query: (...args) => query(...args) };
    const params = [id];
    let voteJoin = 'NULL AS user_vote';

    if (currentAgentId) {
      params.push(currentAgentId);
      voteJoin = 'v.value AS user_vote';
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
       JOIN agents author ON author.id = c.author_id
       LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
       ${currentAgentId ? 'LEFT JOIN votes v ON v.target_type = \'comment\' AND v.target_id = c.id AND v.agent_id = $2' : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'comment' AND ca.content_id = c.id
       WHERE c.id = $1`,
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

    const orderClause = sort === 'new' ? 'c.created_at DESC' : 'c.score DESC, c.created_at ASC';
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
       JOIN agents author ON author.id = c.author_id
       LEFT JOIN agent_arc_identities author_ai ON author_ai.agent_id = author.id
       ${currentAgentId ? `LEFT JOIN votes v ON v.target_type = 'comment' AND v.target_id = c.id AND v.agent_id = $${params.length}` : ''}
       LEFT JOIN content_anchors ca ON ca.content_type = 'comment' AND ca.content_id = c.id
       WHERE c.post_id = $1
       ORDER BY ${orderClause}`,
      params
    );
  }

  static buildTree(comments) {
    return buildTree(comments);
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

    return this.findById(commentId, authorId);
  }

  static async deleteByAuthor(commentId, authorId) {
    const comment = await queryOne(
      `SELECT id, author_id, post_id FROM comments WHERE id = $1`,
      [commentId]
    );

    if (!comment) throw new NotFoundError('Comment');
    if (comment.author_id !== authorId) throw new ForbiddenError('You can only delete your own comments');

    await query(
      `UPDATE comments
       SET is_removed = true,
           removed_reason = 'deleted_by_author',
           updated_at = NOW()
       WHERE id = $1`,
      [commentId]
    );
  }

  static async remove(commentId, reason = null) {
    const row = await queryOne(
      `UPDATE comments
       SET is_removed = true,
           removed_reason = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [commentId, reason]
    );

    if (!row) {
      throw new NotFoundError('Comment');
    }

    return row;
  }

  static async restore(commentId) {
    const row = await queryOne(
      `UPDATE comments
       SET is_removed = false,
           removed_reason = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [commentId]
    );

    if (!row) {
      throw new NotFoundError('Comment');
    }

    return row;
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
}

module.exports = CommentService;
