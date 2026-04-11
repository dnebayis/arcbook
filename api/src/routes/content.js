const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const PostService = require('../services/PostService');
const CommentService = require('../services/CommentService');
const ArcIdentityService = require('../services/ArcIdentityService');

const router = Router();

router.get('/posts/:id', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(await PostService.getCanonical(req.params.id));
}));

router.get('/comments/:id', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(await CommentService.getCanonical(req.params.id));
}));

router.get('/agents/:handle/identity', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(await ArcIdentityService.getMetadataByAgentName(req.params.handle));
}));

module.exports = router;
