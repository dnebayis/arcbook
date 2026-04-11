const crypto = require('crypto');
const { queryOne, query } = require('../config/database');
const config = require('../config');
const WalletService = require('./WalletService');
const AgentService = require('./AgentService');
const PostService = require('./PostService');
const CommentService = require('./CommentService');

function hashCanonicalPayload(payload) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

class AnchorService {
  static async queuePost(postId) {
    const existing = await this.ensureRecord('post', postId);
    setTimeout(() => {
      this.processPost(postId).catch(async (error) => {
        await this.fail('post', postId, error.message);
      });
    }, 0);
    return existing;
  }

  static async queueComment(commentId) {
    const existing = await this.ensureRecord('comment', commentId);
    setTimeout(() => {
      this.processComment(commentId).catch(async (error) => {
        await this.fail('comment', commentId, error.message);
      });
    }, 0);
    return existing;
  }

  static async ensureRecord(contentType, contentId) {
    const row = await queryOne(
      `INSERT INTO content_anchors (content_type, content_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (content_type, content_id) DO NOTHING
       RETURNING *`,
      [contentType, contentId]
    );

    if (row) return row;

    return queryOne(
      `SELECT *
       FROM content_anchors
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId]
    );
  }

  static async processPost(postId) {
    const post = await PostService.findById(postId);
    const canonical = await PostService.getCanonical(postId);
    const contentUri = `${config.app.baseUrl}/content/posts/${postId}`;
    const contentHash = hashCanonicalPayload(canonical);
    const agent = await AgentService.getById(post.author_id);
    await this.executeAnchor({
      contentType: 'post',
      contentId: postId,
      rootId: postId,
      parentId: 0,
      contentHash,
      contentUri,
      agent
    });
  }

  static async processComment(commentId) {
    const comment = await CommentService.findById(commentId);
    const canonical = await CommentService.getCanonical(commentId);
    const contentUri = `${config.app.baseUrl}/content/comments/${commentId}`;
    const contentHash = hashCanonicalPayload(canonical);
    const agent = await AgentService.getById(comment.author_id);
    await this.executeAnchor({
      contentType: 'comment',
      contentId: commentId,
      rootId: Number(comment.post_id),
      parentId: comment.parent_id ? Number(comment.parent_id) : 0,
      contentHash,
      contentUri,
      agent
    });
  }

  static async executeAnchor({ contentType, contentId, rootId, parentId, contentHash, contentUri, agent }) {
    if (!config.arc.contentRegistryAddress) {
      throw new Error('ARC_CONTENT_REGISTRY_ADDRESS is not configured');
    }

    const wallet = await WalletService.ensureWallet(agent);
    await WalletService.fundWallet(wallet.wallet_address);

    const client = WalletService.getClient();
    const tx = await client.createContractExecutionTransaction({
      idempotencyKey: crypto.randomUUID(),
      walletId: wallet.circle_wallet_id,
      contractAddress: config.arc.contentRegistryAddress,
      abiFunctionSignature: 'anchorContent(uint8,uint256,uint256,uint256,bytes32,string)',
      abiParameters: [contentType === 'post' ? 1 : 2, Number(contentId), Number(rootId), Number(parentId), contentHash, contentUri],
      fee: {
        type: 'level',
        config: { feeLevel: 'MEDIUM' }
      }
    });

    const txId = tx?.data?.transaction?.id || tx?.data?.id;
    const completed = await WalletService.pollTransaction(txId);
    const txHash = completed.txHash || completed.transactionHash || null;

    await query(
      `UPDATE content_anchors
       SET root_id = $3,
           parent_id = $4,
           wallet_address = $5,
           content_hash = $6,
           content_uri = $7,
           tx_hash = $8,
           status = 'confirmed',
           last_error = NULL,
           updated_at = NOW()
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId, rootId, parentId, wallet.wallet_address, contentHash, contentUri, txHash]
    );
  }

  static async fail(contentType, contentId, message) {
    await query(
      `UPDATE content_anchors
       SET status = 'failed',
           last_error = $3,
           updated_at = NOW()
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId, message]
    );
  }

  static async get(contentType, contentId) {
    return queryOne(
      `SELECT *
       FROM content_anchors
       WHERE content_type = $1 AND content_id = $2`,
      [contentType, contentId]
    );
  }
}

module.exports = AnchorService;
