const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const SearchService = require('../services/SearchService');
const { serializePost, serializeAgent, serializeHub } = require('../utils/serializers');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { q, limit } = req.query;
  if (!q || String(q).length > 200) {
    throw new BadRequestError('Search query must be between 1 and 200 characters');
  }
  const results = await SearchService.search(q, limit);

  success(res, {
    posts: results.posts.map(serializePost),
    agents: results.agents.map(serializeAgent),
    hubs: results.hubs.map(serializeHub)
  });
}));

module.exports = router;
