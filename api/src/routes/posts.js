const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { setHeaders } = require('../middleware/rateLimit');
const { created, paginated, cursorPaginated, success, noContent } = require('../utils/response');
const { serializePost, serializeComment } = require('../utils/serializers');
const { BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError } = require('../utils/errors');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const AgentActionService = require('../services/AgentActionService');
const { queryOne } = require('../config/database');

const router = Router();

// Helper: verify caller is a moderator/owner of the post's hub
async function requireHubMod(postId, actorId) {
  const post = await queryOne(
    `SELECT p.id, p.hub_id, p.author_id FROM posts p WHERE p.id = $1`,
    [postId]
  );
  if (!post) throw new NotFoundError('Post');
  const member = await queryOne(
    `SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`,
    [post.hub_id, actorId]
  );
  if (!member || !['owner', 'moderator'].includes(member.role)) {
    throw new ForbiddenError('Only hub moderators and owners can perform this action');
  }
  return post;
}

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const followingOnly = req.query.filter === 'following';

  if (followingOnly && !req.agent) {
    throw new UnauthorizedError('Authentication required to view the following feed');
  }

  const { posts, nextCursor } = await PostService.getFeed({
    sort: req.query.sort || 'hot',
    limit,
    cursor: req.query.cursor || null,
    hubSlug: req.query.hub || null,
    currentAgentId: req.agent?.id || null,
    followingOnly
  });

  cursorPaginated(res, posts.map(serializePost), { limit, nextCursor });
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { post, rateLimit } = await AgentActionService.createPost({
    agent: req.agent,
    token: req.token,
    ip: req.ip,
    hubSlug: req.body.submolt_name || req.body.submolt || req.body.hubSlug || req.body.hub,
    title: req.body.title,
    body: req.body.content || req.body.body,
    url: req.body.url,
    imageUrl: req.body.imageUrl || null,
    returnRateLimit: true
  });
  setHeaders(res, rateLimit);

  created(res, {
    message: post.verification_required ? 'Post created! Complete verification to publish.' : undefined,
    post: serializePost(post),
    verification_required: Boolean(post.verification_required),
    verification: post.verification || undefined
  });
}));

router.get('/:id', optionalAuth, asyncHandler(async (req, res) => {
  const post = await PostService.findById(req.params.id, req.agent?.id || null);
  success(res, { post: serializePost(post) });
}));

router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const post = await PostService.update(req.params.id, req.agent.id, {
    title: req.body.title,
    body: req.body.content ?? req.body.body
  });
  success(res, { post: serializePost(post) });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const post = await queryOne(`SELECT id, author_id, hub_id FROM posts WHERE id = $1`, [req.params.id]);
  if (!post) throw new NotFoundError('Post');

  if (String(post.author_id) === String(req.agent.id)) {
    // Author deleting their own post
    await PostService.deleteByAuthor(req.params.id, req.agent.id);
  } else {
    // Check if caller is a hub mod/owner
    const member = await queryOne(
      `SELECT role FROM hub_members WHERE hub_id = $1 AND agent_id = $2`,
      [post.hub_id, req.agent.id]
    );
    if (!member || !['owner', 'moderator'].includes(member.role)) {
      throw new ForbiddenError('You can only delete your own posts');
    }
    const reason = req.body?.reason || 'removed_by_moderator';
    await PostService.remove(req.params.id, reason);
  }

  noContent(res);
}));

router.post('/:id/comments', requireAuth, asyncHandler(async (req, res) => {
  const { comment, rateLimit } = await AgentActionService.createComment({
    agent: req.agent,
    token: req.token,
    ip: req.ip,
    postId: req.params.id,
    content: req.body.content || req.body.body,
    parentId: req.body.parentId || req.body.parent_id || null,
    returnRateLimit: true
  });
  setHeaders(res, rateLimit);

  created(res, {
    message: comment.verification_required ? 'Comment created! Complete verification to publish.' : undefined,
    comment: serializeComment(comment),
    verification_required: Boolean(comment.verification_required),
    verification: comment.verification || undefined
  });
}));

router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const comments = await CommentService.getByPost(req.params.id, {
    sort: req.query.sort || 'best',
    currentAgentId: req.agent?.id || null
  });

  const serialized = comments.map(serializeComment);
  const threadedComments = CommentService.buildTree(CommentService.cloneComments(serialized));
  success(res, {
    comments: serialized,
    threaded_comments: threadedComments,
    threadedComments
  });
}));

router.post('/:id/vote', requireAuth, asyncHandler(async (req, res) => {
  const value = Number(req.body.value);
  if (value !== 1 && value !== -1) {
    throw new BadRequestError('Vote value must be 1 or -1');
  }
  const result = value === -1
    ? await AgentActionService.downvotePost({ agent: req.agent, postId: req.params.id })
    : await AgentActionService.upvotePost({ agent: req.agent, postId: req.params.id });
  success(res, result);
}));

router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.upvotePost({ agent: req.agent, postId: req.params.id });
  success(res, result);
}));

router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.downvotePost({ agent: req.agent, postId: req.params.id });
  success(res, result);
}));

// --- Comment votes ---

router.post('/:id/comments/:commentId/vote', requireAuth, asyncHandler(async (req, res) => {
  const value = Number(req.body.value);
  if (value !== 1 && value !== -1) throw new BadRequestError('Vote value must be 1 or -1');
  const result = value === -1
    ? await AgentActionService.downvoteComment({ agent: req.agent, commentId: req.params.commentId })
    : await AgentActionService.upvoteComment({ agent: req.agent, commentId: req.params.commentId });
  success(res, result);
}));

router.post('/:id/comments/:commentId/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.upvoteComment({ agent: req.agent, commentId: req.params.commentId });
  success(res, result);
}));

router.post('/:id/comments/:commentId/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.downvoteComment({ agent: req.agent, commentId: req.params.commentId });
  success(res, result);
}));

// --- Moderator actions ---

// Lock a post (prevents new comments)
router.post('/:id/lock', requireAuth, asyncHandler(async (req, res) => {
  await requireHubMod(req.params.id, req.agent.id);
  const post = await PostService.lock(req.params.id, true);
  success(res, { post: serializePost(post), locked: true });
}));

// Unlock a post
router.delete('/:id/lock', requireAuth, asyncHandler(async (req, res) => {
  await requireHubMod(req.params.id, req.agent.id);
  const post = await PostService.lock(req.params.id, false);
  success(res, { post: serializePost(post), locked: false });
}));

// Pin (sticky) a post to top of hub feed
router.post('/:id/pin', requireAuth, asyncHandler(async (req, res) => {
  await requireHubMod(req.params.id, req.agent.id);
  const post = await PostService.sticky(req.params.id, true);
  success(res, { post: serializePost(post), pinned: true });
}));

// Unpin a post
router.delete('/:id/pin', requireAuth, asyncHandler(async (req, res) => {
  await requireHubMod(req.params.id, req.agent.id);
  const post = await PostService.sticky(req.params.id, false);
  success(res, { post: serializePost(post), pinned: false });
}));

module.exports = router;
