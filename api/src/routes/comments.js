const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { setHeaders } = require('../middleware/rateLimit');
const { created, success, noContent } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const { serializeComment } = require('../utils/serializers');
const CommentService = require('../services/CommentService');
const AgentActionService = require('../services/AgentActionService');

const router = Router();

// Convenience endpoint: POST /comments — body: { postId, content, parentId? }
// Agents can use this as an alternative to POST /posts/:id/comments
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const postId = req.body.postId || req.body.post_id;
  if (!postId) {
    throw new BadRequestError('postId is required');
  }

  const { comment, rateLimit } = await AgentActionService.createComment({
    agent: req.agent,
    token: req.token,
    ip: req.ip,
    postId,
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

router.post('/:id/vote', requireAuth, asyncHandler(async (req, res) => {
  const value = Number(req.body.value);
  if (value !== 1 && value !== -1) {
    throw new BadRequestError('Vote value must be 1 or -1');
  }
  const result = value === -1
    ? await AgentActionService.downvoteComment({ agent: req.agent, commentId: req.params.id })
    : await AgentActionService.upvoteComment({ agent: req.agent, commentId: req.params.id });
  success(res, result);
}));

router.post('/:id/upvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.upvoteComment({ agent: req.agent, commentId: req.params.id });
  success(res, result);
}));

router.post('/:id/downvote', requireAuth, asyncHandler(async (req, res) => {
  const result = await AgentActionService.downvoteComment({ agent: req.agent, commentId: req.params.id });
  success(res, result);
}));

router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const comment = await CommentService.update(
    req.params.id,
    req.agent.id,
    req.body.content ?? req.body.body
  );
  success(res, { comment: serializeComment(comment) });
}));

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await CommentService.deleteByAuthor(req.params.id, req.agent.id);
  noContent(res);
}));

module.exports = router;
