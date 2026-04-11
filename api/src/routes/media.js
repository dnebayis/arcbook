const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { created } = require('../utils/response');
const MediaService = require('../services/MediaService');

const router = Router();

router.post('/images', requireAuth, asyncHandler(async (req, res) => {
  const asset = await MediaService.createImage({
    agentId: req.agent.id,
    usage: req.body.usage,
    contentType: req.body.contentType,
    data: req.body.data,
    filename: req.body.filename
  });

  created(res, { asset });
}));

module.exports = router;
