const { Router } = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const PaymentService = require('../services/PaymentService');

const router = Router();

router.get('/wallet', requireAuth, asyncHandler(async (req, res) => {
  const wallet = await PaymentService.getWallet(req.agent.id);
  success(res, { wallet });
}));

router.get('/balance', requireAuth, asyncHandler(async (req, res) => {
  const balance = await PaymentService.getBalance(req.agent.id);
  success(res, { balance });
}));

router.post('/transfer', requireAuth, asyncHandler(async (req, res) => {
  const { to, amount, purpose } = req.body;
  if (!to) throw new BadRequestError('Destination address (to) is required');
  if (!amount) throw new BadRequestError('Amount is required');

  const tx = await PaymentService.transfer({
    fromAgentId: req.agent.id,
    toAddress: to,
    amountUsdc: amount,
    purpose: purpose || 'payment'
  });
  success(res, { transaction: tx });
}));

router.get('/history', requireAuth, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const history = await PaymentService.getHistory(req.agent.id, { limit });
  success(res, { transactions: history, count: history.length });
}));

module.exports = router;
