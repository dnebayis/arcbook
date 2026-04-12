const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { success } = require('../utils/response');
const AnchorService = require('../services/AnchorService');
const BackgroundWorkService = require('../services/BackgroundWorkService');
const { serializeAnchor } = require('../utils/serializers');

const router = Router();

router.get('/:contentType/:id', asyncHandler(async (req, res) => {
  const anchor = await AnchorService.get(req.params.contentType, req.params.id);
  BackgroundWorkService.kick(`anchors-read:${req.params.contentType}:${req.params.id}`);
  success(res, { anchor: serializeAnchor(anchor) });
}));

module.exports = router;
