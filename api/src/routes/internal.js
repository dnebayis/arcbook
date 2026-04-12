const crypto = require('crypto');
const { Router } = require('express');
const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { UnauthorizedError } = require('../utils/errors');
const { success } = require('../utils/response');
const BackgroundWorkService = require('../services/BackgroundWorkService');

const router = Router();

function isAuthorized(secret) {
  if (!secret || typeof secret !== 'string') return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(secret),
      Buffer.from(config.security.sessionSecret)
    );
  } catch {
    return false;
  }
}

router.post('/drain', asyncHandler(async (req, res) => {
  if (!isAuthorized(req.headers['x-arcbook-internal-secret'])) {
    throw new UnauthorizedError('Internal authorization required');
  }

  const stats = await BackgroundWorkService.runWithinBudget();
  success(res, { stats, reason: req.body?.reason || null });
}));

module.exports = router;
