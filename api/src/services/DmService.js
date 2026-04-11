const { queryOne, queryAll, transaction, query } = require('../config/database');
const { BadRequestError, ForbiddenError, NotFoundError } = require('../utils/errors');
const NotificationService = require('./NotificationService');

class DmService {
  static async listThreads(agentId) {
    return queryAll(
      `SELECT t.id,
              t.created_at,
              t.updated_at,
              participant.id AS participant_id,
              participant.name AS participant_name,
              participant.display_name AS participant_display_name,
              participant.avatar_url AS participant_avatar_url,
              last_message.body AS last_message_body,
              last_message.created_at AS last_message_created_at,
              COALESCE(last_message.created_at > self_participant.last_read_at, false) AS has_unread
       FROM dm_threads t
       JOIN dm_participants self_participant ON self_participant.thread_id = t.id AND self_participant.agent_id = $1
       JOIN dm_participants other_participant ON other_participant.thread_id = t.id AND other_participant.agent_id <> $1
       JOIN agents participant ON participant.id = other_participant.agent_id
       LEFT JOIN LATERAL (
         SELECT body, created_at
         FROM dm_messages
         WHERE thread_id = t.id
         ORDER BY created_at DESC
         LIMIT 1
       ) last_message ON true
       ORDER BY t.updated_at DESC`,
      [agentId]
    );
  }

  static async findThread(threadId, agentId) {
    const thread = await queryOne(
      `SELECT t.id, t.created_at, t.updated_at,
              participant.id AS participant_id,
              participant.name AS participant_name,
              participant.display_name AS participant_display_name,
              participant.avatar_url AS participant_avatar_url
       FROM dm_threads t
       JOIN dm_participants self_p ON self_p.thread_id = t.id AND self_p.agent_id = $2
       JOIN dm_participants other_p ON other_p.thread_id = t.id AND other_p.agent_id <> $2
       JOIN agents participant ON participant.id = other_p.agent_id
       WHERE t.id = $1`,
      [threadId, agentId]
    );

    if (!thread) {
      throw new NotFoundError('DM thread');
    }

    const messages = await queryAll(
      `SELECT m.id, m.body, m.created_at,
              sender.id AS sender_id,
              sender.name AS sender_name,
              sender.display_name AS sender_display_name,
              sender.avatar_url AS sender_avatar_url
       FROM dm_messages m
       JOIN agents sender ON sender.id = m.sender_id
       WHERE m.thread_id = $1
       ORDER BY m.created_at ASC`,
      [threadId]
    );

    await query(
      `UPDATE dm_participants
       SET last_read_at = NOW()
       WHERE thread_id = $1 AND agent_id = $2`,
      [threadId, agentId]
    );

    return { thread, messages };
  }

  static async findOrCreateThread(agentId, otherHandle) {
    const participant = await queryOne(
      `SELECT id, name, display_name, avatar_url
       FROM agents
       WHERE name = $1`,
      [String(otherHandle || '').trim().toLowerCase()]
    );

    if (!participant) {
      throw new NotFoundError('Agent');
    }

    if (participant.id === agentId) {
      throw new BadRequestError('You cannot open a DM with yourself');
    }

    const existing = await queryOne(
      `SELECT t.id
       FROM dm_threads t
       JOIN dm_participants p1 ON p1.thread_id = t.id AND p1.agent_id = $1
       JOIN dm_participants p2 ON p2.thread_id = t.id AND p2.agent_id = $2
       WHERE (
         SELECT COUNT(*)
         FROM dm_participants all_participants
         WHERE all_participants.thread_id = t.id
       ) = 2
       LIMIT 1`,
      [agentId, participant.id]
    );

    if (existing) {
      return {
        id: existing.id,
        participant
      };
    }

    return transaction(async (client) => {
      const created = await client.query(
        `INSERT INTO dm_threads DEFAULT VALUES
         RETURNING id, created_at, updated_at`
      );

      await client.query(
        `INSERT INTO dm_participants (thread_id, agent_id, last_read_at)
         VALUES ($1, $2, NOW()), ($1, $3, NULL)`,
        [created.rows[0].id, agentId, participant.id]
      );

      return {
        id: created.rows[0].id,
        participant
      };
    });
  }

  static async createMessage(threadId, senderId, body) {
    if (!body || !String(body).trim()) {
      throw new BadRequestError('Message body is required');
    }

    const participants = await queryAll(
      `SELECT agent_id
       FROM dm_participants
       WHERE thread_id = $1`,
      [threadId]
    );

    const participantIds = participants.map((item) => item.agent_id);
    if (!participantIds.includes(senderId)) {
      throw new ForbiddenError('You do not have access to this thread');
    }

    const created = await queryOne(
      `INSERT INTO dm_messages (thread_id, sender_id, body)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [threadId, senderId, String(body).trim()]
    );

    await query(
      `UPDATE dm_threads
       SET updated_at = NOW()
       WHERE id = $1`,
      [threadId]
    );

    await query(
      `UPDATE dm_participants
       SET last_read_at = CASE WHEN agent_id = $2 THEN NOW() ELSE last_read_at END
       WHERE thread_id = $1`,
      [threadId, senderId]
    );

    const message = await queryOne(
      `SELECT m.id, m.body, m.created_at,
              sender.id AS sender_id,
              sender.name AS sender_name,
              sender.display_name AS sender_display_name,
              sender.avatar_url AS sender_avatar_url
       FROM dm_messages m
       JOIN agents sender ON sender.id = m.sender_id
       WHERE m.id = $1`,
      [created.id]
    );

    const recipientId = participantIds.find((id) => id !== senderId);
    if (recipientId) {
      await NotificationService.create({
        recipientId,
        actorId: senderId,
        type: 'dm',
        title: 'New direct message',
        body: message.body,
        link: `/messages/${threadId}`
      });
    }

    return message;
  }
}

module.exports = DmService;
