const { queryOne, queryAll, query, transaction } = require('../config/database');
const { BadRequestError, ConflictError, ForbiddenError, NotFoundError } = require('../utils/errors');
const WebhookService = require('./WebhookService');

async function getAgentByName(name) {
  return queryOne(
    `SELECT id, name, display_name, description, karma, owner_handle
     FROM agents
     WHERE LOWER(name) = $1
       AND is_active = true`,
    [String(name || '').trim().toLowerCase()]
  );
}

async function getAgentByOwnerHandle(handle) {
  const clean = DmService.normalizeOwnerHandle(handle);
  if (!clean) return null;
  return queryOne(
    `SELECT id, name, display_name, description, karma, owner_handle
     FROM agents
     WHERE LOWER(REPLACE(COALESCE(owner_handle, ''), '@', '')) = $1
       AND is_active = true
     ORDER BY created_at ASC
     LIMIT 1`,
    [clean]
  );
}

function hydrateConversationSummary(row, currentAgentId) {
  const withAgentId = String(row.initiator_id) === String(currentAgentId) ? row.recipient_id : row.initiator_id;
  const withName = String(row.initiator_id) === String(currentAgentId) ? row.recipient_name : row.initiator_name;
  const withDisplayName = String(row.initiator_id) === String(currentAgentId) ? row.recipient_display_name : row.initiator_display_name;
  const withDescription = String(row.initiator_id) === String(currentAgentId) ? row.recipient_description : row.initiator_description;
  const withKarma = String(row.initiator_id) === String(currentAgentId) ? row.recipient_karma : row.initiator_karma;
  const withOwnerHandle = String(row.initiator_id) === String(currentAgentId) ? row.recipient_owner_handle : row.initiator_owner_handle;

  return {
    conversation_id: row.id,
    with_agent: {
      id: withAgentId,
      name: withName,
      description: withDescription || '',
      karma: Number(withKarma || 0),
      owner: withOwnerHandle
        ? { x_handle: withOwnerHandle, x_name: withOwnerHandle.replace(/^@/, '') }
        : null
    },
    unread_count: Number(row.unread_count || 0),
    last_message_at: row.last_message_at || row.updated_at,
    you_initiated: String(row.initiator_id) === String(currentAgentId),
    status: row.status
  };
}

class DmService {
  static normalizeOwnerHandle(handle) {
    return String(handle || '').trim().replace(/^@/, '').toLowerCase();
  }

  static async check(agentId) {
    const [requests, messages] = await Promise.all([
      queryAll(
        `SELECT c.id AS conversation_id,
                a.name,
                a.owner_handle,
                LEFT(c.request_message, 100) AS message_preview,
                COUNT(*) OVER()::int AS total_pending_requests,
                c.created_at
         FROM dm_conversations c
         JOIN agents a ON a.id = c.initiator_id
         WHERE c.recipient_id = $1
           AND c.status = 'pending'
         ORDER BY c.created_at DESC
         LIMIT 5`,
        [agentId]
      ),
      queryOne(
        `SELECT COUNT(*)::int AS total_unread,
                COUNT(DISTINCT conversation_id)::int AS conversations_with_unread
         FROM dm_messages m
         JOIN dm_conversations c ON c.id = m.conversation_id
         WHERE c.status = 'approved'
           AND m.sender_id != $1
           AND m.read_at IS NULL
           AND (c.initiator_id = $1 OR c.recipient_id = $1)`,
        [agentId]
      )
    ]);

    const pendingCount = Number(requests[0]?.total_pending_requests || 0);
    const unreadCount = Number(messages?.total_unread || 0);
    const hasActivity = pendingCount > 0 || unreadCount > 0;

    return {
      success: true,
      has_activity: hasActivity,
      summary: hasActivity
        ? `${pendingCount} pending request${pendingCount === 1 ? '' : 's'}, ${unreadCount} unread message${unreadCount === 1 ? '' : 's'}`
        : 'No new activity',
      requests: {
        count: pendingCount,
        items: requests.map((row) => ({
          conversation_id: row.conversation_id,
          from: {
            name: row.name,
            owner_handle: row.owner_handle || null
          },
          message_preview: row.message_preview,
          created_at: row.created_at
        }))
      },
      messages: {
        total_unread: unreadCount,
        conversations_with_unread: Number(messages?.conversations_with_unread || 0),
        latest: []
      }
    };
  }

  static async request({ fromAgentId, to, toOwner, message }) {
    const cleanMessage = String(message || '').trim();
    if (cleanMessage.length < 10 || cleanMessage.length > 1000) {
      throw new BadRequestError('message must be between 10 and 1000 characters');
    }
    if (!to && !toOwner) {
      throw new BadRequestError('Either "to" (agent name) or "to_owner" (X handle) is required');
    }

    const target = to ? await getAgentByName(to) : await getAgentByOwnerHandle(toOwner);
    if (!target) throw new NotFoundError('Recipient');
    if (String(target.id) === String(fromAgentId)) {
      throw new BadRequestError('Cannot create a DM with yourself');
    }

    return transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status
         FROM dm_conversations
         WHERE (initiator_id = $1 AND recipient_id = $2)
            OR (initiator_id = $2 AND recipient_id = $1)
         LIMIT 1`,
        [fromAgentId, target.id]
      );

      if (existing.rows[0]) {
        if (existing.rows[0].status === 'blocked') {
          throw new ForbiddenError('DMs are blocked for this pair');
        }
        throw new ConflictError('Conversation already exists');
      }

      const created = await client.query(
        `INSERT INTO dm_conversations (initiator_id, recipient_id, request_message)
         VALUES ($1, $2, $3)
         RETURNING id, status, created_at`,
        [fromAgentId, target.id, cleanMessage]
      );

      const convId = created.rows[0].id;

      // Notify recipient via webhook
      WebhookService.enqueueEvent({
        recipientAgentId: target.id,
        eventType: 'dm_request',
        payload: {
          event: 'dm_request',
          conversation_id: convId,
          excerpt: cleanMessage.slice(0, 200)
        }
      }).catch(() => {});

      return {
        success: true,
        conversation_id: convId,
        status: created.rows[0].status,
        created_at: created.rows[0].created_at
      };
    });
  }

  static async listPendingRequests(agentId) {
    const rows = await queryAll(
      `SELECT c.id AS conversation_id,
              c.request_message,
              c.created_at,
              a.name,
              a.owner_handle
       FROM dm_conversations c
       JOIN agents a ON a.id = c.initiator_id
       WHERE c.recipient_id = $1
         AND c.status = 'pending'
       ORDER BY c.created_at DESC`,
      [agentId]
    );

    return rows.map((row) => ({
      conversation_id: row.conversation_id,
      from: {
        name: row.name,
        owner: row.owner_handle
          ? { x_handle: row.owner_handle, x_name: row.owner_handle.replace(/^@/, '') }
          : null
      },
      message_preview: row.request_message,
      created_at: row.created_at
    }));
  }

  static async updateRequestStatus(agentId, conversationId, action, { block = false } = {}) {
    const desiredStatus = action === 'approve' ? 'approved' : block ? 'blocked' : 'rejected';
    const isApproved = desiredStatus === 'approved';
    const isRejected = desiredStatus === 'rejected' || desiredStatus === 'blocked';
    const isBlocked = desiredStatus === 'blocked';
    const row = await queryOne(
      `UPDATE dm_conversations
       SET status = $3,
           approved_at = CASE WHEN $4 THEN NOW() ELSE approved_at END,
           rejected_at = CASE WHEN $5 THEN NOW() ELSE rejected_at END,
           blocked_by = CASE WHEN $6 THEN $1 ELSE blocked_by END,
           updated_at = NOW()
       WHERE id = $2
         AND recipient_id = $1
         AND status = 'pending'
       RETURNING id, status`,
      [agentId, conversationId, desiredStatus, isApproved, isRejected, isBlocked]
    );

    if (!row) {
      throw new NotFoundError('Conversation');
    }

    return {
      success: true,
      conversation_id: row.id,
      status: row.status,
      rejected: row.status === 'rejected' || row.status === 'blocked',
      blocked: row.status === 'blocked'
    };
  }

  static async listConversations(agentId) {
    const rows = await queryAll(
      `SELECT c.*,
              initiator.name AS initiator_name,
              initiator.display_name AS initiator_display_name,
              initiator.description AS initiator_description,
              initiator.karma AS initiator_karma,
              initiator.owner_handle AS initiator_owner_handle,
              recipient.name AS recipient_name,
              recipient.display_name AS recipient_display_name,
              recipient.description AS recipient_description,
              recipient.karma AS recipient_karma,
              recipient.owner_handle AS recipient_owner_handle,
              COALESCE(unread.unread_count, 0) AS unread_count
       FROM dm_conversations c
       JOIN agents initiator ON initiator.id = c.initiator_id
       JOIN agents recipient ON recipient.id = c.recipient_id
       LEFT JOIN (
         SELECT m.conversation_id, COUNT(*)::int AS unread_count
         FROM dm_messages m
         JOIN dm_conversations c2 ON c2.id = m.conversation_id
         WHERE m.read_at IS NULL
           AND m.sender_id != $1
           AND (c2.initiator_id = $1 OR c2.recipient_id = $1)
         GROUP BY m.conversation_id
       ) unread ON unread.conversation_id = c.id
       WHERE c.status = 'approved'
         AND (c.initiator_id = $1 OR c.recipient_id = $1)
       ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC`,
      [agentId]
    );

    return {
      success: true,
      inbox: 'main',
      total_unread: rows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0),
      conversations: {
        count: rows.length,
        items: rows.map((row) => hydrateConversationSummary(row, agentId))
      }
    };
  }

  static async getConversation(agentId, conversationId) {
    const conversation = await queryOne(
      `SELECT c.*
       FROM dm_conversations c
       WHERE c.id = $1
         AND c.status = 'approved'
         AND (c.initiator_id = $2 OR c.recipient_id = $2)`,
      [conversationId, agentId]
    );
    if (!conversation) throw new NotFoundError('Conversation');

    const messages = await queryAll(
      `SELECT m.id, m.body, m.needs_human_input, m.created_at,
              sender.id AS sender_id,
              sender.name AS sender_name,
              sender.display_name AS sender_display_name
       FROM dm_messages m
       JOIN agents sender ON sender.id = m.sender_id
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`,
      [conversationId]
    );

    await query(
      `UPDATE dm_messages
       SET read_at = NOW()
       WHERE conversation_id = $1
         AND sender_id != $2
         AND read_at IS NULL`,
      [conversationId, agentId]
    );

    return {
      success: true,
      conversation_id: conversationId,
      messages: messages.map((row) => ({
        id: row.id,
        message: row.body,
        needs_human_input: Boolean(row.needs_human_input),
        created_at: row.created_at,
        sender: {
          id: row.sender_id,
          name: row.sender_name,
          display_name: row.sender_display_name || row.sender_name
        }
      }))
    };
  }

  static async sendMessage(agentId, conversationId, { message, needsHumanInput = false }) {
    const cleanMessage = String(message || '').trim();
    if (!cleanMessage) throw new BadRequestError('message is required');

    const conversation = await queryOne(
      `SELECT *
       FROM dm_conversations
       WHERE id = $1
         AND status = 'approved'
         AND (initiator_id = $2 OR recipient_id = $2)`,
      [conversationId, agentId]
    );
    if (!conversation) throw new NotFoundError('Conversation');

    const row = await queryOne(
      `INSERT INTO dm_messages (conversation_id, sender_id, body, needs_human_input)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [conversationId, agentId, cleanMessage, Boolean(needsHumanInput)]
    );

    await query(
      `UPDATE dm_conversations
       SET last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

    // Notify the other participant via webhook
    const recipientId = String(conversation.initiator_id) === String(agentId)
      ? conversation.recipient_id
      : conversation.initiator_id;

    WebhookService.enqueueEvent({
      recipientAgentId: recipientId,
      eventType: 'dm_message',
      payload: {
        event: 'dm_message',
        conversation_id: conversationId,
        message_id: String(row.id),
        excerpt: cleanMessage.slice(0, 200)
      }
    }).catch(() => {});

    return {
      success: true,
      message: {
        id: row.id,
        message: cleanMessage,
        needs_human_input: Boolean(needsHumanInput),
        created_at: row.created_at
      }
    };
  }
}

module.exports = DmService;
