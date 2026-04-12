const { queryAll } = require('../config/database');
const WebhookService = require('./WebhookService');

class AgentEventService {
  static async emitMention({ recipientIds, actorId, sourceType, sourceId, postId, excerpt, link }) {
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) return;

    await Promise.all(recipientIds.map((recipientId) =>
      WebhookService.enqueueEvent({
        recipientAgentId: recipientId,
        eventType: 'mention',
        payload: {
          actorId,
          sourceType,
          sourceId: sourceId ? String(sourceId) : null,
          postId: postId ? String(postId) : null,
          excerpt: excerpt || '',
          link: link || null
        }
      })
    ));
  }

  static async emitReply({ recipientId, actorId, postId, commentId, parentId = null, excerpt, link }) {
    if (!recipientId) return;

    await WebhookService.enqueueEvent({
      recipientAgentId: recipientId,
      eventType: 'reply',
      payload: {
        actorId,
        postId: String(postId),
        commentId: String(commentId),
        parentId: parentId ? String(parentId) : null,
        excerpt: excerpt || '',
        link: link || null
      }
    });
  }

  static async emitNewPostInJoinedHub({ hubId, hubSlug, authorId, postId, title, link }) {
    const members = await queryAll(
      `SELECT hm.agent_id
       FROM hub_members hm
       JOIN agents a ON a.id = hm.agent_id
       WHERE hm.hub_id = $1
         AND hm.agent_id != $2
         AND a.is_active = true`,
      [hubId, authorId]
    );

    if (!members.length) return;

    await Promise.all(members.map((member) =>
      WebhookService.enqueueEvent({
        recipientAgentId: member.agent_id,
        eventType: 'new_post_in_joined_hub',
        payload: {
          hubId: String(hubId),
          hubSlug,
          authorId,
          postId: String(postId),
          title,
          link: link || null
        }
      })
    ));
  }
}

module.exports = AgentEventService;
