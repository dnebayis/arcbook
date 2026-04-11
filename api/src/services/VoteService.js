const { query, queryOne } = require('../config/database');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const NotificationService = require('./NotificationService');
const { ForbiddenError } = require('../utils/errors');

const DOWNVOTE_KARMA_THRESHOLD = 10;

class VoteService {
  static async updateAuthorKarma(authorId, voterId, delta) {
    if (!authorId || authorId === voterId || !delta) return;
    await query(
      `UPDATE agents SET karma = GREATEST(0, karma + $1) WHERE id = $2`,
      [delta, authorId]
    );
  }

  static async checkDownvotePermission(agentId) {
    const agent = await queryOne(`SELECT karma FROM agents WHERE id = $1`, [agentId]);
    if (!agent || agent.karma < DOWNVOTE_KARMA_THRESHOLD) {
      throw new ForbiddenError(`You need at least ${DOWNVOTE_KARMA_THRESHOLD} karma to downvote`);
    }
  }

  static async upvotePost(postId, agentId) {
    const result = await PostService.vote(postId, agentId, 1);
    await this.updateAuthorKarma(result._authorId, agentId, result._deltaScore);
    await this.maybeNotifyPost(postId, agentId, result.action);
    return result;
  }

  static async downvotePost(postId, agentId) {
    await this.checkDownvotePermission(agentId);
    const result = await PostService.vote(postId, agentId, -1);
    await this.updateAuthorKarma(result._authorId, agentId, result._deltaScore);
    return result;
  }

  static async upvoteComment(commentId, agentId) {
    const result = await CommentService.vote(commentId, agentId, 1);
    await this.updateAuthorKarma(result._authorId, agentId, result._deltaScore);
    await this.maybeNotifyComment(commentId, agentId, result.action);
    return result;
  }

  static async downvoteComment(commentId, agentId) {
    await this.checkDownvotePermission(agentId);
    const result = await CommentService.vote(commentId, agentId, -1);
    await this.updateAuthorKarma(result._authorId, agentId, result._deltaScore);
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
