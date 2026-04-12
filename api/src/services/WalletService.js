const crypto = require('crypto');
const {
  initiateDeveloperControlledWalletsClient
} = require('@circle-fin/developer-controlled-wallets');
const { queryOne } = require('../config/database');
const config = require('../config');
const { BadRequestError } = require('../utils/errors');
const { classifyAnchorFailure } = require('../utils/anchors');

const TERMINAL_TRANSACTION_STATES = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

class WalletService {
  static getClient() {
    this.assertCircleConfiguration();

    return initiateDeveloperControlledWalletsClient({
      apiKey: config.circle.apiKey,
      entitySecret: config.circle.entitySecret
    });
  }

  static assertCircleConfiguration() {
    const missing = [];
    if (!config.circle.apiKey) missing.push('CIRCLE_API_KEY');
    if (!config.circle.entitySecret) missing.push('CIRCLE_ENTITY_SECRET');
    if (!config.circle.treasuryWalletId) missing.push('CIRCLE_TREASURY_WALLET_ID');

    if (missing.length) {
      throw new BadRequestError(`Missing Circle configuration: ${missing.join(', ')}`);
    }
  }

  static async getWallet(agentId) {
    return queryOne(
      `SELECT *
       FROM agent_wallets
       WHERE agent_id = $1`,
      [agentId]
    );
  }

  static async ensureWallet(agent) {
    const client = this.getClient();
    let wallet = await this.getWallet(agent.id);

    if (!wallet) {
      wallet = await queryOne(
        `INSERT INTO agent_wallets (agent_id)
         VALUES ($1)
         RETURNING *`,
        [agent.id]
      );
    }

    if (!wallet.circle_wallet_set_id) {
      const walletSetResponse = await client.createWalletSet({
        idempotencyKey: crypto.randomUUID(),
        name: `arcbook-${agent.name}`
      });

      const walletSetId = walletSetResponse.data?.walletSet?.id;
      if (!walletSetId) {
        throw new Error('Circle did not return a wallet set ID');
      }

      wallet = await queryOne(
        `UPDATE agent_wallets
         SET circle_wallet_set_id = $2,
             updated_at = NOW()
         WHERE agent_id = $1
         RETURNING *`,
        [agent.id, walletSetId]
      );
    }

    if (!wallet.circle_wallet_id || !wallet.wallet_address) {
      const walletResponse = await client.createWallets({
        idempotencyKey: crypto.randomUUID(),
        walletSetId: wallet.circle_wallet_set_id,
        blockchains: [config.arc.blockchain],
        count: 1
      });

      const created = walletResponse.data?.wallets?.[0];
      if (!created?.id || !created?.address) {
        throw new Error('Circle did not return a valid wallet');
      }

      wallet = await queryOne(
        `UPDATE agent_wallets
         SET circle_wallet_id = $2,
             wallet_address = $3,
             updated_at = NOW()
         WHERE agent_id = $1
         RETURNING *`,
        [agent.id, created?.id, created?.address]
      );
    }

    return wallet;
  }

  static async fundWallet(destinationAddress, options = {}) {
    const client = this.getClient();
    const fundingResponse = await client.createTransaction({
      idempotencyKey: crypto.randomUUID(),
      walletId: config.circle.treasuryWalletId,
      blockchain: config.arc.blockchain,
      tokenAddress: config.arc.usdcTokenAddress,
      amount: [config.arc.treasuryFundingAmountUsdc],
      destinationAddress,
      fee: {
        type: 'level',
        config: { feeLevel: 'MEDIUM' }
      }
    });

    const txId = fundingResponse?.data?.transaction?.id || fundingResponse?.data?.id;
    if (!txId) {
      throw new Error('Circle did not return a funding transaction id');
    }

    return this.pollTransaction(txId, options);
  }

  static async getTransaction(transactionId) {
    const client = this.getClient();
    const response = await client.getTransaction({ id: transactionId });
    return response.data?.transaction || response.data || null;
  }

  static normalizeTransactionFailure(transaction, error = null) {
    const classification = classifyAnchorFailure(error || new Error('Circle transaction failed'), transaction);
    const txHash = transaction?.txHash || transaction?.transactionHash || null;
    const state = transaction?.state || 'FAILED';
    const detailMessage = [
      transaction?.errorReason,
      transaction?.failureReason,
      transaction?.errorDetails,
      transaction?.failureDetails,
      error?.message
    ].filter(Boolean).join(' | ');

    return {
      code: classification.code === 'unknown' ? 'circle_failed' : classification.code,
      retryable: classification.retryable,
      message: detailMessage || classification.message || `Circle transaction ended in state ${state}`,
      txHash,
      state
    };
  }

  static async pollTransaction(transactionId, { maxAttempts = 20, intervalMs = 2500 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      const transaction = await this.getTransaction(transactionId);
      const state = transaction?.state || null;

      if (state && TERMINAL_TRANSACTION_STATES.has(state)) {
        if (state !== 'COMPLETE') {
          const normalized = this.normalizeTransactionFailure(transaction);
          const error = new Error(normalized.message);
          error.code = normalized.code;
          error.retryable = normalized.retryable;
          error.transaction = transaction;
          error.txHash = normalized.txHash;
          error.circleTransactionId = transactionId;
          throw error;
        }

        return transaction;
      }
    }

    const pending = new Error('Timed out while waiting for Circle transaction confirmation');
    pending.code = 'circle_pending';
    pending.retryable = true;
    pending.circleTransactionId = transactionId;
    throw pending;
  }
}

module.exports = WalletService;
