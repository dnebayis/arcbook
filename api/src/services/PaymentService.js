const crypto = require('crypto');
const { query, queryOne, queryAll } = require('../config/database');
const config = require('../config');
const {
  BadRequestError,
  ConflictError,
  NotFoundError
} = require('../utils/errors');
const WalletService = require('./WalletService');
const AgentService = require('./AgentService');

class PaymentService {
  static normalizeTransferError(error, amountUsdc) {
    const message = [
      error?.message,
      error?.response?.data?.message,
      error?.response?.data?.error,
      error?.cause?.message
    ].filter(Boolean).join(' | ');
    const normalized = message.toLowerCase();

    if (normalized.includes('asset amount owned by the wallet is insufficient')
      || normalized.includes('insufficient funds')
      || normalized.includes('insufficient balance')) {
      return new ConflictError(
        'Insufficient USDC balance',
        'INSUFFICIENT_FUNDS',
        `Reduce the transfer amount or top up the wallet before retrying. Requested: ${amountUsdc} USDC`
      );
    }

    if (normalized.includes('not authorized') || normalized.includes('unauthorized')) {
      return new BadRequestError(
        'Payment wallet is not authorized for transfers',
        'PAYMENT_NOT_AUTHORIZED',
        'Check the Circle wallet configuration and transfer policy for this agent wallet'
      );
    }

    return error;
  }

  static async getBalance(agentId) {
    const wallet = await WalletService.getWallet(agentId);
    if (!wallet?.wallet_address) {
      return { usdc: '0.000000', walletAddress: null, hasWallet: false };
    }

    const client = WalletService.getClient();
    const response = await client.getWalletTokenBalance({ id: wallet.circle_wallet_id });
    const balances = response?.data?.tokenBalances || [];
    const usdcBalance = balances.find((b) =>
      b.token?.symbol === 'USDC' ||
      b.token?.address?.toLowerCase() === config.arc.usdcTokenAddress?.toLowerCase()
    );

    return {
      usdc: usdcBalance?.amount || '0.000000',
      walletAddress: wallet.wallet_address,
      circleWalletId: wallet.circle_wallet_id,
      hasWallet: true
    };
  }

  static async getWallet(agentId) {
    const agent = await AgentService.getById(agentId);
    if (!agent) throw new NotFoundError('Agent');

    const wallet = await WalletService.ensureWallet(agent);
    return {
      walletAddress: wallet.wallet_address,
      circleWalletId: wallet.circle_wallet_id,
      blockchain: config.arc.blockchain
    };
  }

  static async transfer({ fromAgentId, toAddress, amountUsdc, purpose = 'payment', toAgentId = null }) {
    if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) {
      throw new BadRequestError('Valid destination wallet address (0x...) required');
    }

    const amount = parseFloat(amountUsdc);
    if (!amount || amount <= 0) {
      throw new BadRequestError('Amount must be a positive number');
    }

    const agent = await AgentService.getById(fromAgentId);
    if (!agent) throw new NotFoundError('Agent');

    const wallet = await WalletService.ensureWallet(agent);
    const client = WalletService.getClient();
    const balance = await this.getBalance(fromAgentId);

    if (parseFloat(balance.usdc || '0') < amount) {
      throw new ConflictError(
        'Insufficient USDC balance',
        'INSUFFICIENT_FUNDS',
        `Current balance: ${balance.usdc} USDC. Requested: ${amountUsdc} USDC`
      );
    }

    let txResponse;
    try {
      txResponse = await client.createTransaction({
        idempotencyKey: crypto.randomUUID(),
        walletId: wallet.circle_wallet_id,
        blockchain: config.arc.blockchain,
        tokenAddress: config.arc.usdcTokenAddress,
        amount: [String(amountUsdc)],
        destinationAddress: toAddress,
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
      });
    } catch (error) {
      throw this.normalizeTransferError(error, amountUsdc);
    }

    const txId = txResponse?.data?.transaction?.id || txResponse?.data?.id;
    if (!txId) {
      throw new Error('Circle did not return a transaction ID');
    }

    // Insert as pending immediately
    const record = await queryOne(
      `INSERT INTO agent_transactions
         (from_agent_id, to_agent_id, from_wallet_address, to_wallet_address,
          amount_usdc, circle_transaction_id, status, purpose)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING *`,
      [fromAgentId, toAgentId, wallet.wallet_address, toAddress, amountUsdc, txId, purpose]
    );

    // Poll for completion (non-blocking if it times out — status updates via background check)
    try {
      const completed = await WalletService.pollTransaction(txId, { maxAttempts: 20, intervalMs: 2500 });
      const txHash = completed.txHash || completed.transactionHash || null;
      const status = completed.state === 'COMPLETE' ? 'confirmed' : 'failed';

      await query(
        `UPDATE agent_transactions
         SET status = $1, tx_hash = $2, updated_at = NOW()
         WHERE id = $3`,
        [status, txHash, record.id]
      );

      return { ...record, status, tx_hash: txHash };
    } catch {
      return record;
    }
  }

  static async getHistory(agentId, { limit = 20 } = {}) {
    return queryAll(
      `SELECT t.*,
              fa.name AS from_agent_name,
              ta.name AS to_agent_name
       FROM agent_transactions t
       LEFT JOIN agents fa ON fa.id = t.from_agent_id
       LEFT JOIN agents ta ON ta.id = t.to_agent_id
       WHERE t.from_agent_id = $1 OR t.to_agent_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
  }
}

module.exports = PaymentService;
