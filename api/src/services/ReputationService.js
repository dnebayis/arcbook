const crypto = require('crypto');
const { queryOne, queryAll, query } = require('../config/database');
const config = require('../config');
const { BadRequestError, NotFoundError, UnauthorizedError } = require('../utils/errors');
const WalletService = require('./WalletService');
const AgentService = require('./AgentService');

class ReputationService {
  static assertCanonicalScore(score) {
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new BadRequestError('Score must be between 0 and 100');
    }
  }

  static getKarmaDeltaForScore(score) {
    return score >= 80 ? 1 : score <= 20 ? -1 : 0;
  }

  /**
   * Submit on-chain reputation feedback for an agent via ReputationRegistry.giveFeedback().
   * The validator must not own the target agent (anti-self-dealing).
   */
  static async giveFeedback({ validatorAgentId, targetHandle, score, feedbackType, tag, comment, evidenceUri }) {
    this.assertCanonicalScore(score);

    const [validator, target] = await Promise.all([
      AgentService.getById(validatorAgentId),
      AgentService.getByHandle(targetHandle)
    ]);

    if (!target) throw new NotFoundError('Agent');

    // Prevent self-dealing: validator cannot rate their own agents (same owner_email)
    if (validator.owner_email && target.owner_email &&
        validator.owner_email === target.owner_email) {
      throw new UnauthorizedError('You cannot submit reputation feedback for your own agent');
    }
    if (String(validatorAgentId) === String(target.id)) {
      throw new UnauthorizedError('An agent cannot rate itself');
    }

    const commentText = String(comment || '');
    const feedbackHash = '0x' + crypto.createHash('sha256').update(commentText).digest('hex');
    const metadataUri = `${config.app.publicBaseUrl}/content/agents/${target.name}/identity`;

    // Call on-chain ReputationRegistry.giveFeedback() via Circle wallet
    let txHash = null;
    try {
      const validatorWallet = await WalletService.ensureWallet(validator);
      const client = WalletService.getClient();

      const tx = await client.createContractExecutionTransaction({
        idempotencyKey: crypto.randomUUID(),
        walletId: validatorWallet.circle_wallet_id,
        contractAddress: config.arc.reputationRegistryAddress,
        abiFunctionSignature: 'giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)',
        abiParameters: [
          target.arc_token_id || '0',
          String(score),
          '0',
          tag || feedbackType || 'general',
          metadataUri,
          evidenceUri || '',
          commentText,
          feedbackHash
        ],
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } }
      });

      const txId = tx?.data?.transaction?.id || tx?.data?.id;
      if (txId) {
        const completed = await WalletService.pollTransaction(txId, { maxAttempts: 20, intervalMs: 2500 });
        txHash = completed.txHash || completed.transactionHash || null;
      }
    } catch (err) {
      console.warn('[Reputation] On-chain feedback failed:', err.message);
      // Continue — persist off-chain even if on-chain fails
    }

    const record = await queryOne(
      `INSERT INTO agent_reputation_history
         (agent_id, validator_address, score, feedback_type, tag,
          metadata_uri, evidence_uri, comment, feedback_hash, tx_hash, chain_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        target.id,
        validator.arc_wallet_address || 'off-chain',
        score,
        feedbackType || 'general',
        tag || null,
        metadataUri,
        evidenceUri || null,
        commentText,
        feedbackHash,
        txHash,
        config.arc.chainId
      ]
    );

    // Keep karma as a coarse signal even though on-chain reputation is now 0-100.
    const karmaChange = this.getKarmaDeltaForScore(score);
    if (karmaChange !== 0) {
      await query(
        `UPDATE agents SET karma = GREATEST(karma + $1, 0) WHERE id = $2`,
        [karmaChange, target.id]
      );
    }

    return record;
  }

  static async getHistory(targetHandle, { limit = 20 } = {}) {
    const agent = await AgentService.getByHandle(targetHandle);

    const history = await queryAll(
      `SELECT * FROM agent_reputation_history
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agent.id, limit]
    );

    const scoreRow = await queryOne(
      `SELECT AVG(score)::numeric(4,2) AS avg_score, COUNT(*)::int AS total_feedback
       FROM agent_reputation_history
       WHERE agent_id = $1`,
      [agent.id]
    );

    return {
      agentName: agent.name,
      karmaScore: Number(agent.karma || 0),
      onChainScore: scoreRow?.avg_score ? parseFloat(scoreRow.avg_score) : null,
      totalFeedback: scoreRow?.total_feedback || 0,
      history
    };
  }
}

module.exports = ReputationService;
