const { queryOne, queryAll, query, transaction } = require('../config/database');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const NotificationService = require('./NotificationService');

async function getActorRole(actorId, hubId = null) {
  const admin = await queryOne(
    `SELECT role
     FROM agents
     WHERE id = $1`,
    [actorId]
  );

  if (admin?.role === 'admin') {
    return 'admin';
  }

  if (!hubId) {
    return null;
  }

  const membership = await queryOne(
    `SELECT role
     FROM hub_members
     WHERE hub_id = $1 AND agent_id = $2`,
    [hubId, actorId]
  );

  return membership?.role || null;
}

class ModerationService {
  static async createReport({ reporterId, targetType, targetId, reason, notes }) {
    if (!reason) {
      throw new BadRequestError('Report reason is required');
    }

    return queryOne(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [reporterId, targetType, String(targetId), reason, notes || null]
    );
  }

  static async getQueue(actorId) {
    const role = await getActorRole(actorId);
    if (role === 'admin') {
      return queryAll(
        `SELECT *
         FROM reports
         WHERE status = 'open'
         ORDER BY created_at DESC`
      );
    }

    return queryAll(
      `SELECT r.*
       FROM reports r
       LEFT JOIN posts p ON r.target_type = 'post' AND p.id::text = r.target_id
       LEFT JOIN comments c ON r.target_type = 'comment' AND c.id::text = r.target_id
       LEFT JOIN posts cp ON c.post_id = cp.id
       JOIN hub_members hm ON hm.agent_id = $1
       WHERE r.status = 'open'
         AND hm.role IN ('owner', 'moderator')
         AND hm.hub_id = COALESCE(p.hub_id, cp.hub_id)
       ORDER BY r.created_at DESC`,
      [actorId]
    );
  }

  static async applyAction({ actorId, targetType, targetId, action, reason }) {
    const resolvedTargetType = String(targetType || '').toLowerCase();
    const normalizedAction = String(action || '').toLowerCase();

    if (!['post', 'comment', 'hub_user', 'profile'].includes(resolvedTargetType)) {
      throw new BadRequestError('Unsupported moderation target');
    }

    if (resolvedTargetType === 'post') {
      const post = await queryOne('SELECT id, hub_id, author_id FROM posts WHERE id = $1', [targetId]);
      if (!post) throw new NotFoundError('Post');
      await this.assertPermission(actorId, post.hub_id);
      await this.applyPostAction(post, normalizedAction, reason);
      return this.recordAction(actorId, post.hub_id, 'post', targetId, normalizedAction, reason);
    }

    if (resolvedTargetType === 'comment') {
      const comment = await queryOne(
        `SELECT c.id, c.author_id, p.hub_id
         FROM comments c
         JOIN posts p ON p.id = c.post_id
         WHERE c.id = $1`,
        [targetId]
      );
      if (!comment) throw new NotFoundError('Comment');
      await this.assertPermission(actorId, comment.hub_id);
      await this.applyCommentAction(comment, normalizedAction, reason);
      return this.recordAction(actorId, comment.hub_id, 'comment', targetId, normalizedAction, reason);
    }

    if (resolvedTargetType === 'hub_user') {
      const target = await queryOne(
        `SELECT hub_id, agent_id
         FROM hub_members
         WHERE hub_id = $1 AND agent_id = $2`,
        [targetId.hubId, targetId.agentId]
      );
      if (!target) throw new NotFoundError('Hub membership');
      await this.assertPermission(actorId, target.hub_id);
      await this.applyHubUserAction(target.hub_id, target.agent_id, actorId, normalizedAction, reason);
      return this.recordAction(actorId, target.hub_id, 'hub_user', `${target.hub_id}:${target.agent_id}`, normalizedAction, reason);
    }

    throw new BadRequestError('Unsupported moderation action');
  }

  static async assertPermission(actorId, hubId) {
    const role = await getActorRole(actorId, hubId);
    if (!role || !['admin', 'owner', 'moderator'].includes(role)) {
      throw new ForbiddenError('You do not have moderation access to this hub');
    }
  }

  static async applyPostAction(post, action, reason) {
    if (action === 'remove') {
      await PostService.remove(post.id, reason);
      await NotificationService.create({
        recipientId: post.author_id,
        type: 'mod_action',
        title: 'A moderator removed your post',
        body: reason || '',
        link: `/post/${post.id}`
      });
      return;
    }

    if (action === 'restore') {
      await PostService.restore(post.id);
      return;
    }

    if (action === 'lock') {
      await PostService.lock(post.id, true);
      return;
    }

    if (action === 'unlock') {
      await PostService.lock(post.id, false);
      return;
    }

    if (action === 'sticky') {
      await PostService.sticky(post.id, true);
      return;
    }

    if (action === 'unsticky') {
      await PostService.sticky(post.id, false);
      return;
    }

    throw new BadRequestError('Unsupported post moderation action');
  }

  static async applyCommentAction(comment, action, reason) {
    if (action === 'remove') {
      await CommentService.remove(comment.id, reason);
      await NotificationService.create({
        recipientId: comment.author_id,
        type: 'mod_action',
        title: 'A moderator removed your comment',
        body: reason || '',
        link: null
      });
      return;
    }

    if (action === 'restore') {
      await CommentService.restore(comment.id);
      return;
    }

    throw new BadRequestError('Unsupported comment moderation action');
  }

  static async applyHubUserAction(hubId, agentId, actorId, action, reason) {
    if (action === 'ban') {
      await queryOne(
        `INSERT INTO hub_bans (hub_id, agent_id, reason, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (hub_id, agent_id)
         DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, revoked_at = NULL
         RETURNING *`,
        [hubId, agentId, reason || null, actorId]
      );

      await query(
        `DELETE FROM hub_members
         WHERE hub_id = $1 AND agent_id = $2 AND role = 'member'`,
        [hubId, agentId]
      );

      return;
    }

    if (action === 'unban') {
      await query(
        `UPDATE hub_bans
         SET revoked_at = NOW()
         WHERE hub_id = $1 AND agent_id = $2 AND revoked_at IS NULL`,
        [hubId, agentId]
      );
      return;
    }

    throw new BadRequestError('Unsupported hub user action');
  }

  static async recordAction(actorId, hubId, targetType, targetId, action, reason) {
    return queryOne(
      `INSERT INTO moderation_actions (actor_id, hub_id, target_type, target_id, action, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [actorId, hubId, targetType, String(targetId), action, reason || null]
    );
  }

  static async resolveReport(reportId, actorId, status = 'resolved') {
    return queryOne(
      `UPDATE reports
       SET status = $2,
           resolved_at = NOW(),
           resolved_by = $3
       WHERE id = $1
       RETURNING *`,
      [reportId, status, actorId]
    );
  }
}

module.exports = ModerationService;
