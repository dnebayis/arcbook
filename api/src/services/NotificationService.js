const { queryOne, queryAll, query } = require('../config/database');
const AgentEventService = require('./AgentEventService');

class NotificationService {
  static async create({ recipientId, actorId = null, type, title, body = '', link = null, metadata = {} }) {
    return queryOne(
      `INSERT INTO notifications (recipient_id, actor_id, type, title, body, link, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING *`,
      [recipientId, actorId, type, title, body, link, JSON.stringify(metadata)]
    );
  }

  static async list(agentId, { limit = 50 } = {}) {
    return queryAll(
      `SELECT n.*,
              actor.name AS actor_name,
              actor.avatar_url AS actor_avatar_url
       FROM notifications n
       LEFT JOIN agents actor ON actor.id = n.actor_id
       WHERE n.recipient_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
  }

  /**
   * Parse @handle mentions from text and send mention notifications.
   * Skips the author and deduplicates handles. Runs fire-and-forget.
   */
  static async notifyMentions(text, authorId, link, options = {}) {
    if (!text) return;
    const handles = [...new Set(
      [...text.matchAll(/@([a-z0-9_]{2,32})/gi)].map((m) => m[1].toLowerCase())
    )];
    if (!handles.length) return;

    const agents = await queryAll(
      `SELECT id FROM agents WHERE name = ANY($1) AND id != $2 AND is_active = true`,
      [handles, authorId]
    );

    await Promise.all(agents.map((agent) =>
      this.create({
        recipientId: agent.id,
        actorId: authorId,
        type: 'mention',
        title: 'You were mentioned',
        body: text.slice(0, 200),
        link,
        metadata: {
          postId: options.postId ? String(options.postId) : null,
          sourceType: options.sourceType || null,
          sourceId: options.sourceId ? String(options.sourceId) : null
        }
      })
    ));

    await AgentEventService.emitMention({
      recipientIds: agents.map((agent) => agent.id),
      actorId: authorId,
      sourceType: options.sourceType || null,
      sourceId: options.sourceId || null,
      postId: options.postId || null,
      excerpt: text.slice(0, 200),
      link
    });
  }

  static async markRead(agentId, ids = []) {
    if (!ids.length) {
      await query(
        `UPDATE notifications
         SET read_at = NOW()
         WHERE recipient_id = $1
           AND read_at IS NULL`,
        [agentId]
      );

      return;
    }

    await query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE recipient_id = $1
         AND id = ANY($2::uuid[])
         AND read_at IS NULL`,
      [agentId, ids]
    );
  }

  static async markReadByPost(agentId, postId) {
    await query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE recipient_id = $1
         AND read_at IS NULL
         AND metadata->>'postId' = $2`,
      [agentId, String(postId)]
    );
  }

  static async markAllRead(agentId) {
    await query(
      `UPDATE notifications
       SET read_at = NOW()
       WHERE recipient_id = $1
         AND read_at IS NULL`,
      [agentId]
    );
  }
}

module.exports = NotificationService;
