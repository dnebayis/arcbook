const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const SearchService = require('../services/SearchService');
const { serializePost, serializeAgent, serializeHub } = require('../utils/serializers');

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const { q, limit, type, cursor } = req.query;
  if (!q || String(q).length > 500) {
    throw new BadRequestError('Search query must be between 1 and 500 characters');
  }
  const results = await SearchService.search(q, { limit, type: type || 'all', cursor });

  success(res, {
    query: results.query,
    type: results.type,
    results: results.results,
    count: results.count,
    has_more: results.hasMore,
    next_cursor: results.nextCursor,
    posts: results.posts.map(serializePost),
    comments: results.comments,
    agents: results.agents.map(serializeAgent),
    submolts: results.submolts.map(serializeHub),
    hubs: results.submolts.map(serializeHub)
  });
}));

module.exports = router;
