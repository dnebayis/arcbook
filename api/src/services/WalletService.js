const crypto = require('crypto');
const {
  initiateDeveloperControlledWalletsClient
} = require('@circle-fin/developer-controlled-wallets');
const { queryOne } = require('../config/database');
const config = require('../config');
const { BadRequestError } = require('../utils/errors');
const { classifyAnchorFailure } = require('../utils/anchors');

const TERMINAL_TRANSACTION_STATES = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);
const ARC_ANCHOR_RECORD_SIGNATURE = 'anchors(uint8,uint256)';

class WalletService {
  static anchorRecordSelector = null;

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

  static parseUnits(value, decimals) {
    const text = String(value || '0').trim();
    if (!/^\d+(\.\d+)?$/.test(text)) {
      throw new Error(`Invalid decimal amount: ${text}`);
    }

    const [whole, fraction = ''] = text.split('.');
    const paddedFraction = `${fraction}${'0'.repeat(decimals)}`.slice(0, decimals);
    return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(paddedFraction || '0');
  }

  static async rpcRequest(method, params) {
    const response = await fetch(config.arc.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params
      })
    });

    const payload = await response.json();
    if (payload.error) {
      throw new Error(payload.error.message || `RPC ${method} failed`);
    }

    return payload.result;
  }

  static async getMethodSelector(signature) {
    if (signature === ARC_ANCHOR_RECORD_SIGNATURE && this.anchorRecordSelector) {
      return this.anchorRecordSelector;
    }

    const hexInput = `0x${Buffer.from(signature, 'utf8').toString('hex')}`;
    const hash = await this.rpcRequest('web3_sha3', [hexInput]);
    const selector = String(hash || '').slice(0, 10);

    if (!selector || selector.length !== 10) {
      throw new Error(`Failed to compute selector for ${signature}`);
    }

    if (signature === ARC_ANCHOR_RECORD_SIGNATURE) {
      this.anchorRecordSelector = selector;
    }

    return selector;
  }

  static async getNativeBalance(address) {
    const result = await this.rpcRequest('eth_getBalance', [address, 'latest']);
    return BigInt(result || '0x0');
  }

  static async ensureSufficientGasBalance(destinationAddress, options = {}) {
    const minBalance = options.minBalanceUsdc || config.arc.minWalletBalanceUsdc;

    try {
      const balanceWei = await this.getNativeBalance(destinationAddress);
      const thresholdWei = this.parseUnits(minBalance, 18);
      if (balanceWei >= thresholdWei) {
        return { funded: false, balanceWei, thresholdWei };
      }
    } catch (error) {
      console.warn(`[Wallet] Balance check failed for ${destinationAddress}: ${error.message}`);
    }

    await this.fundWallet(destinationAddress, options);
    return { funded: true };
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

  static padHexWord(value) {
    const hex = typeof value === 'bigint'
      ? value.toString(16)
      : BigInt(value).toString(16);
    return hex.padStart(64, '0');
  }

  static async getContentAnchorRecord(contentType, localId) {
    if (!config.arc.contentRegistryAddress) return null;

    const selector = await this.getMethodSelector(ARC_ANCHOR_RECORD_SIGNATURE);
    const data = [
      selector.slice(2),
      this.padHexWord(contentType),
      this.padHexWord(localId)
    ].join('');

    const result = await this.rpcRequest('eth_call', [{
      to: config.arc.contentRegistryAddress,
      data: `0x${data}`
    }, 'latest']);

    const hex = String(result || '').replace(/^0x/, '');
    if (!hex || hex.length < 256) {
      return null;
    }

    const createdAt = BigInt(`0x${hex.slice(64, 128)}`);
    if (createdAt === 0n) {
      return null;
    }

    const authorWord = hex.slice(0, 64);
    const contentHashWord = hex.slice(128, 192);

    return {
      author: `0x${authorWord.slice(24)}`.toLowerCase(),
      createdAt,
      contentHash: `0x${contentHashWord}`.toLowerCase()
    };
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
