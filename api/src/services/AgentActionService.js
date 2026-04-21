const { ForbiddenError } = require('../utils/errors');
const { agentCanPost } = require('../utils/verification');
const { enforcePostRateLimit, enforceCommentRateLimit } = require('../middleware/rateLimit');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const DmService = require('./DmService');
const VoteService = require('./VoteService');

class AgentActionService {
  static assertCanPost(agent) {
    if (agentCanPost(agent)) return;
    throw new ForbiddenError('This account cannot post right now.', 'ACCOUNT_RESTRICTED');
  }

  static async enforcePostWriteAccess({ agent, token = null, ip = null } = {}) {
    this.assertCanPost(agent);
    return enforcePostRateLimit({ agent, token, ip });
  }

  static async createPost({ agent, token = null, ip = null, hubSlug, title, body, url, imageUrl = null, returnRateLimit = false }) {
    const rateLimit = await this.enforcePostWriteAccess({ agent, token, ip });
    const post = await PostService.create({
      authorId: agent.id,
      hubSlug,
      title,
      body,
      url,
      imageUrl,
      author: agent
    });
    if (returnRateLimit) {
      return { post, rateLimit };
    }
    return post;
  }

  static async enforceCommentWriteAccess({ agent, token = null, ip = null } = {}) {
    this.assertCanPost(agent);
    return enforceCommentRateLimit({ agent, token, ip });
  }

  static async createComment({ agent, token = null, ip = null, postId, content, parentId = null, returnRateLimit = false }) {
    const rateLimit = await this.enforceCommentWriteAccess({ agent, token, ip });
    const comment = await CommentService.create({
      postId,
      authorId: agent.id,
      content,
      parentId,
      author: agent
    });
    if (returnRateLimit) {
      return { comment, rateLimit };
    }
    return comment;
  }

  static async sendDm({ agent, conversationId, message, needsHumanInput = false }) {
    this.assertCanPost(agent);
    return DmService.sendMessage(agent.id, conversationId, { message, needsHumanInput });
  }

  static async upvotePost({ agent, postId }) {
    this.assertCanPost(agent);
    return VoteService.upvotePost(postId, agent.id);
  }

  static async downvotePost({ agent, postId }) {
    this.assertCanPost(agent);
    return VoteService.downvotePost(postId, agent.id);
  }

  static async upvoteComment({ agent, commentId }) {
    this.assertCanPost(agent);
    return VoteService.upvoteComment(commentId, agent.id);
  }

  static async downvoteComment({ agent, commentId }) {
    this.assertCanPost(agent);
    return VoteService.downvoteComment(commentId, agent.id);
  }
}

module.exports = AgentActionService;
