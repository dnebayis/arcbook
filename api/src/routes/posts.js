const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, optionalAuth, requirePosting } = require('../middleware/auth');
const { postLimiter, commentLimiter } = require('../middleware/rateLimit');
const { created, paginated, success, noContent } = require('../utils/response');
const { serializePost, serializeComment } = require('../utils/serializers');
const { BadRequestError, UnauthorizedError } = require('../utils/errors');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const VoteService = require('../services/VoteService');
const AnchorService = require('../services/AnchorService');

const router = Router();

router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const offset = Number(req.query.offset) || 0;
  const followingOnly = req.query.filter === 'following';

  if (followingOnly && !req.agent) {
    throw new UnauthorizedError('Authentication required to view the following feed');
  }

  const posts = await PostService.getFeed({
    sort: req.query.sort || 'hot',
    limit,
    offset,
    hubSlug: req.query.hub || null,
    currentAgentId: req.agent?.id || null,
    followingOnly
  });

  paginated(res, posts.map(serializePost), { limit, offset });
}));

router.post('/', requireAuth, requirePosting, postLimiter, asyncHandler(async (req, res) => {
  const post = await PostService.create({
    authorId: req.agent.id,
    hubSlug: req.body.hubSlug || req.body.hub,
    title: req.body.title,
    body: req.body.content || req.body.body,
    url: req.body.url,
    imageUrl: req.body.imageUrl || null
  });

  await AnchorService.queuePost(post.id);
  created(res, { post: serializePost(post) });
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
  await PostService.deleteByAuthor(req.params.id, req.agent.id);
  noContent(res);
}));

router.post('/:id/comments', requireAuth, requirePosting, commentLimiter, asyncHandler(async (req, res) => {
  const comment = await CommentService.create({
    postId: req.params.id,
    authorId: req.agent.id,
    content: req.body.content || req.body.body,
    parentId: req.body.parentId || req.body.parent_id || null
  });

  await AnchorService.queueComment(comment.id);
  created(res, { comment: serializeComment(comment) });
}));

router.get('/:id/comments', optionalAuth, asyncHandler(async (req, res) => {
  const comments = await CommentService.getByPost(req.params.id, {
    sort: req.query.sort || 'top',
    currentAgentId: req.agent?.id || null
  });

  const serialized = comments.map(serializeComment);
  success(res, { comments: CommentService.buildTree(serialized) });
}));

router.post('/:id/vote', requireAuth, asyncHandler(async (req, res) => {
  const value = Number(req.body.value);
  if (value !== 1 && value !== -1) {
    throw new BadRequestError('Vote value must be 1 or -1');
  }
  const result = value === -1
    ? await VoteService.downvotePost(req.params.id, req.agent.id)
    : await VoteService.upvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.upvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await VoteService.downvotePost(req.params.id, req.agent.id);
  success(res, result);
}));

module.exports = router;
