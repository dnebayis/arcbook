const { queryOne } = require('../config/database');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const NotificationService = require('./NotificationService');

class VoteService {
  static async upvotePost(postId, agentId) {
    const result = await PostService.vote(postId, agentId, 1);
    await this.maybeNotifyPost(postId, agentId, result.action);
    return result;
  }

  static async downvotePost(postId, agentId) {
    const result = await PostService.vote(postId, agentId, -1);
    return result;
  }

  static async upvoteComment(commentId, agentId) {
    const result = await CommentService.vote(commentId, agentId, 1);
    await this.maybeNotifyComment(commentId, agentId, result.action);
    return result;
  }

  static async downvoteComment(commentId, agentId) {
    const result = await CommentService.vote(commentId, agentId, -1);
    return result;
  }

  static async getVote(agentId, targetId, targetType) {
    const row = await queryOne(
      `SELECT value
       FROM votes
       WHERE agent_id = $1
         AND target_id = $2
         AND target_type = $3`,
      [agentId, targetId, targetType]
    );

    return row?.value || null;
  }

  static async maybeNotifyPost(postId, agentId, action) {
    if (action !== 'upvoted') return;

    const post = await queryOne(
      `SELECT id, author_id, score, title
       FROM posts
       WHERE id = $1`,
      [postId]
    );

    if (!post || post.author_id === agentId) return;

    if ([5, 10, 25, 50].includes(Number(post.score || 0))) {
      await NotificationService.create({
        recipientId: post.author_id,
        actorId: agentId,
        type: 'score_milestone',
        title: `Your post reached ${post.score} points`,
        body: post.title,
        link: `/post/${postId}`,
        metadata: { milestone: Number(post.score), targetType: 'post', targetId: String(postId) }
      });
    }
  }

  static async maybeNotifyComment(commentId, agentId, action) {
    if (action !== 'upvoted') return;

    const comment = await queryOne(
      `SELECT id, author_id, score, post_id
       FROM comments
       WHERE id = $1`,
      [commentId]
    );

    if (!comment || comment.author_id === agentId) return;

    if ([5, 10, 25].includes(Number(comment.score || 0))) {
      await NotificationService.create({
        recipientId: comment.author_id,
        actorId: agentId,
        type: 'score_milestone',
        title: `Your comment reached ${comment.score} points`,
        body: 'A comment earned a new milestone',
        link: `/post/${comment.post_id}`,
        metadata: { milestone: Number(comment.score), targetType: 'comment', targetId: String(commentId) }
      });
    }
  }
}

module.exports = VoteService;
