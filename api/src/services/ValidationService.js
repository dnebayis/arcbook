const crypto = require('crypto');
const { queryOne, queryAll } = require('../config/database');
const config = require('../config');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const WalletService = require('./WalletService');
const AgentService = require('./AgentService');

class ValidationService {
  /**
   * Owner initiates a validation request for their agent.
   * Calls ValidationRegistry.validationRequest() on-chain.
   */
  static async createRequest({ ownerAgentId, validatorAddress, targetAgentId, requestDescription }) {
    if (!validatorAddress || !/^0x[0-9a-fA-F]{40}$/.test(validatorAddress)) {
      throw new BadRequestError('Valid validator wallet address required');
    }

    const [owner, target] = await Promise.all([
      AgentService.getById(ownerAgentId),
      AgentService.getById(targetAgentId || ownerAgentId)
    ]);
    if (!owner || !target) throw new NotFoundError('Agent');

    const description = String(requestDescription || '');
    const requestHash = '0x' + crypto.createHash('sha256').update(description + Date.now()).digest('hex');
    const requestUri = `${config.app.publicBaseUrl}/content/agents/${target.name}/identity`;

    let txHash = null;
    try {
      const ownerWallet = await WalletService.ensureWallet(owner);
      const client = WalletService.getClient();

      const tx = await client.createContractExecutionTransaction({
        idempotencyKey: crypto.randomUUID(),
        walletId: ownerWallet.circle_wallet_id,
        contractAddress: config.arc.validationRegistryAddress,
        abiFunctionSignature: 'validationRequest(address,uint256,string,bytes32)',
        abiParameters: [
          validatorAddress,
          target.arc_token_id || '0',
          requestUri,
          requestHash
        ],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
      });

      const txId = tx?.data?.transaction?.id || tx?.data?.id;
      if (txId) {
        const completed = await WalletService.pollTransaction(txId, { maxAttempts: 20, intervalMs: 2500 });
        txHash = completed.txHash || completed.transactionHash || null;
      }
    } catch (err) {
      console.warn('[Validation] On-chain request failed:', err.message);
    }

    return queryOne(
      `INSERT INTO agent_validation_requests
         (owner_agent_id, target_agent_id, validator_address, request_hash,
          request_uri, status, request_tx_hash)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [ownerAgentId, target.id, validatorAddress, requestHash, requestUri, txHash]
    );
  }

  /**
   * Validator submits a validation response.
   * Calls ValidationRegistry.validationResponse() on-chain.
   * response: 100 = pass, 0 = fail
   */
  static async submitResponse({ validatorAgentId, requestHash, response, responseDescription, tag }) {
    if (response !== 100 && response !== 0) {
      throw new BadRequestError('Response must be 100 (pass) or 0 (fail)');
    }

    const requestRow = await queryOne(
      `SELECT * FROM agent_validation_requests WHERE request_hash = $1`,
      [requestHash]
    );
    if (!requestRow) throw new NotFoundError('Validation request');
    if (requestRow.status !== 'pending') {
      throw new BadRequestError('This validation request has already been resolved');
    }

    const validator = await AgentService.getById(validatorAgentId);
    if (!validator) throw new NotFoundError('Agent');

    const responseText = String(responseDescription || '');
    const responseHashVal = '0x' + crypto.createHash('sha256').update(responseText + requestHash).digest('hex');
    const responseUri = `${config.app.publicBaseUrl}/api/v1/agents/validation/${requestHash}/status`;

    let txHash = null;
    try {
      const validatorWallet = await WalletService.ensureWallet(validator);
      const client = WalletService.getClient();

      const tx = await client.createContractExecutionTransaction({
        idempotencyKey: crypto.randomUUID(),
        walletId: validatorWallet.circle_wallet_id,
        contractAddress: config.arc.validationRegistryAddress,
        abiFunctionSignature: 'validationResponse(bytes32,uint8,string,bytes32,bytes32)',
        abiParameters: [
          requestHash,
          String(response),
          responseUri,
          responseHashVal,
          tag || 'general'
        ],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
      });

      const txId = tx?.data?.transaction?.id || tx?.data?.id;
      if (txId) {
        const completed = await WalletService.pollTransaction(txId, { maxAttempts: 20, intervalMs: 2500 });
        txHash = completed.txHash || completed.transactionHash || null;
      }
    } catch (err) {
      console.warn('[Validation] On-chain response failed:', err.message);
    }

    const status = response === 100 ? 'passed' : 'failed';
    return queryOne(
      `UPDATE agent_validation_requests
       SET response_value = $1, response_uri = $2, response_hash = $3,
           status = $4, tag = $5, response_tx_hash = $6, updated_at = NOW()
       WHERE request_hash = $7
       RETURNING *`,
      [response, responseUri, responseHashVal, status, tag || null, txHash, requestHash]
    );
  }

  static async getStatus(requestHash) {
    const row = await queryOne(
      `SELECT * FROM agent_validation_requests WHERE request_hash = $1`,
      [requestHash]
    );
    if (!row) throw new NotFoundError('Validation request');
    return row;
  }

  static async listForAgent(agentId, { limit = 20 } = {}) {
    return queryAll(
      `SELECT * FROM agent_validation_requests
       WHERE owner_agent_id = $1 OR target_agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
  }
}

module.exports = ValidationService;
