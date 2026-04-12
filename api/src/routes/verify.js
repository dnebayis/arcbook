const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const VerificationService = require('../services/VerificationService');

const router = Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const result = await VerificationService.complete({
    verificationCode: req.body.verification_code,
    answer: req.body.answer
  });

  success(res, {
    message: `Verification successful! Your ${result.contentType} is now published.`,
    content_type: result.contentType,
    content_id: result.contentId
  });
}));

module.exports = router;
