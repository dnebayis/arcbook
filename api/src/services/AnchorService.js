const crypto = require('crypto');
const { queryOne, query, transaction } = require('../config/database');
const config = require('../config');
const WalletService = require('./WalletService');
const AgentService = require('./AgentService');
const PostService = require('./PostService');
const CommentService = require('./CommentService');
const {
  buildAnchorIdempotencyKey,
  classifyAnchorFailure,
  getAnchorRetryDelayMs,
  resolveChainAnchorId
} = require('../utils/anchors');

const TERMINAL_FAILED_STATES = new Set(['FAILED', 'DENIED', 'CANCELLED']);

function hashCanonicalPayload(payload) {
  return `0x${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function toRetryTimestamp(attemptCount) {
  return new Date(Date.now() + getAnchorRetryDelayMs(attemptCount)).toISOString();
}

class AnchorService {
  static async queuePost(postId) {
    return this.enqueue('post', postId);
  }

  static async queueComment(commentId) {
    return this.enqueue('comment', commentId);
  }

  static async enqueue(contentType, contentId) {
    const row = await queryOne(
      `INSERT INTO content_anchors (content_type, content_id, status, next_retry_at)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (content_type, content_id) DO UPDATE
       SET status = CASE
             WHEN content_anchors.status = 'confirmed' THEN content_anchors.status
             ELSE 'pending'
           END,
           next_retry_at = CASE
             WHEN content_anchors.status = 'confirmed' THEN content_anchors.next_retry_at
             ELSE NOW()
           END,
           leased_until = NULL,
           updated_at = NOW()
       RETURNING *`,
      [contentType, contentId]
    );

    const BackgroundWorkService = require('./BackgroundWorkService');
    BackgroundWorkService.kick(`anchor:${contentType}:${contentId}`);
    return row;
  }

  static async retryNow(contentType, contentId) {
    const row = await queryOne(
      `UPDATE content_anchors
       SET status = 'pending',
           leased_until = NULL,
           next_retry_at = NOW(),
           updated_at = NOW()
       WHERE content_type = $1
         AND content_id = $2
       RETURNING *`,
      [contentType, contentId]
    );

    if (!row) {
      return this.enqueue(contentType, contentId);
    }

    const BackgroundWorkService = require('./BackgroundWorkService');
    BackgroundWorkService.kick(`anchor-retry:${contentType}:${contentId}`);
    return row;
  }

  static async processDueBatch({ limit = 1, timeBudgetMs = 2_500 } = {}) {
    const startedAt = Date.now();
    let processed = 0;

    while (processed < limit && Date.now() - startedAt < timeBudgetMs) {
      const row = await this.claimNextDue();
      if (!row) break;

      await this.processClaimedRow(row);
      processed += 1;
    }

    return processed;
  }

  static async claimNextDue() {
    return transaction(async (client) => {
      const result = await client.query(
        `WITH due AS (
           SELECT id
           FROM content_anchors
           WHERE status = 'pending'
             AND next_retry_at <= NOW()
             AND (leased_until IS NULL OR leased_until < NOW())
           ORDER BY next_retry_at ASC, created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE content_anchors a
         SET leased_until = NOW() + ($1 * INTERVAL '1 millisecond'),
             next_retry_at = NOW() + ($1 * INTERVAL '1 millisecond'),
             attempt_count = a.attempt_count + 1,
             last_attempt_at = NOW(),
             updated_at = NOW()
         FROM due
         WHERE a.id = due.id
         RETURNING a.*`,
        [config.webhooks.leaseMs]
      );

      return result.rows[0] || null;
    });
  }

  static async processClaimedRow(row) {
    try {
      if (!config.arc.contentRegistryAddress) {
        await this.markFailed(row, {
          code: 'blocked_config',
          message: 'ARC_CONTENT_REGISTRY_ADDRESS is not configured',
          retryable: false
        });
        return;
      }

      const workItem = await this.buildWorkItem(row);
      if (!workItem) {
        await this.markFailed(row, {
          code: 'missing_content',
          message: 'The anchored content no longer exists',
          retryable: false
        });
        return;
      }

      if (row.last_circle_transaction_id) {
        await this.observeExistingTransaction(row, workItem);
        return;
      }

      const wallet = await WalletService.ensureWallet(workItem.agent);
      try {
        await WalletService.ensureSufficientGasBalance(wallet.wallet_address, { maxAttempts: 8, intervalMs: 1_500 });
      } catch (error) {
        await this.handleProcessingFailure(row, error, {
          walletAddress: wallet.wallet_address,
          ...workItem
        });
        return;
      }

      const client = WalletService.getClient();
      const tx = await client.createContractExecutionTransaction({
        idempotencyKey: buildAnchorIdempotencyKey(
          workItem.contentType,
          workItem.chainLocalId,
          workItem.contentHash
        ),
        walletId: wallet.circle_wallet_id,
        contractAddress: config.arc.contentRegistryAddress,
        abiFunctionSignature: 'anchorContent(uint8,uint256,uint256,uint256,bytes32,string)',
        abiParameters: [
          workItem.contentType === 'post' ? 1 : 2,
          workItem.chainLocalId,
          workItem.chainRootId,
          workItem.chainParentId,
          workItem.contentHash,
          workItem.contentUri
        ],
        fee: {
          type: 'level',
          config: { feeLevel: 'MEDIUM' }
        }
      });

      const transactionId = tx?.data?.transaction?.id || tx?.data?.id;
      if (!transactionId) {
        throw new Error('Circle did not return an anchor transaction id');
      }

      await query(
        `UPDATE content_anchors
         SET root_id = $3,
             parent_id = $4,
             wallet_address = $5,
             content_hash = $6,
             content_uri = $7,
             status = 'pending',
             last_error = NULL,
             last_error_code = NULL,
             last_circle_transaction_id = $8,
             leased_until = NULL,
             next_retry_at = $9,
             chain_local_id = $10,
             chain_root_id = $11,
             chain_parent_id = $12,
             updated_at = NOW()
         WHERE content_type = $1
           AND content_id = $2`,
        [
          workItem.contentType,
          workItem.contentId,
          workItem.rootId,
          workItem.parentId,
          wallet.wallet_address,
          workItem.contentHash,
          workItem.contentUri,
          transactionId,
          toRetryTimestamp(row.attempt_count),
          workItem.chainLocalId,
          workItem.chainRootId,
          workItem.chainParentId
        ]
      );
      console.info(
        `[Anchor] submitted contentType=${workItem.contentType} contentId=${workItem.contentId} chainLocalId=${workItem.chainLocalId} attempt=${row.attempt_count} txId=${transactionId}`
      );
    } catch (error) {
      await this.handleProcessingFailure(row, error);
    }
  }

  static async observeExistingTransaction(row, workItem) {
    try {
      const transaction = await WalletService.getTransaction(row.last_circle_transaction_id);
      const state = transaction?.state || null;
      const txHash = transaction?.txHash || transaction?.transactionHash || null;

      if (state === 'COMPLETE') {
        await query(
          `UPDATE content_anchors
           SET root_id = $3,
               parent_id = $4,
               content_hash = $5,
               content_uri = $6,
               status = 'confirmed',
               tx_hash = $7,
               last_error = NULL,
               last_error_code = NULL,
               leased_until = NULL,
               next_retry_at = NOW(),
               chain_local_id = $8,
               chain_root_id = $9,
               chain_parent_id = $10,
               updated_at = NOW()
           WHERE content_type = $1
             AND content_id = $2`,
          [
            workItem.contentType,
            workItem.contentId,
            workItem.rootId,
            workItem.parentId,
            workItem.contentHash,
            workItem.contentUri,
            txHash,
            workItem.chainLocalId,
            workItem.chainRootId,
            workItem.chainParentId
          ]
        );
        console.info(
          `[Anchor] confirmed contentType=${workItem.contentType} contentId=${workItem.contentId} chainLocalId=${workItem.chainLocalId} attempt=${row.attempt_count} txHash=${txHash || 'none'}`
        );
        return;
      }

      if (state && TERMINAL_FAILED_STATES.has(state)) {
        await this.handleProcessingFailure(row, null, workItem, transaction);
        return;
      }

      await query(
        `UPDATE content_anchors
         SET leased_until = NULL,
             next_retry_at = $3,
             updated_at = NOW()
         WHERE content_type = $1
           AND content_id = $2`,
        [workItem.contentType, workItem.contentId, toRetryTimestamp(row.attempt_count)]
      );
      console.info(
        `[Anchor] waiting_for_circle contentType=${workItem.contentType} contentId=${workItem.contentId} attempt=${row.attempt_count} txId=${row.last_circle_transaction_id} state=${state || 'pending'}`
      );
    } catch (error) {
      await this.handleProcessingFailure(row, error, workItem);
    }
  }

  static async handleProcessingFailure(row, error = null, workItem = null, transaction = null) {
    const classification = classifyAnchorFailure(error, transaction);
    const contentType = workItem?.contentType || row.content_type;
    const contentId = workItem?.contentId || row.content_id;
    const walletAddress = workItem?.walletAddress || row.wallet_address || null;

    if (classification.code === 'already_anchored' && workItem) {
      const reconciled = await this.reconcileAlreadyAnchored(row, workItem);
      if (reconciled) {
        console.info(
          `[Anchor] reconciled_already_anchored contentType=${contentType} contentId=${contentId} attempt=${row.attempt_count}`
        );
        return;
      }
    }

    if (classification.retryable) {
      await query(
        `UPDATE content_anchors
         SET root_id = COALESCE($3, root_id),
             parent_id = COALESCE($4, parent_id),
             wallet_address = COALESCE($5, wallet_address),
             content_hash = COALESCE($6, content_hash),
             content_uri = COALESCE($7, content_uri),
             status = 'pending',
             leased_until = NULL,
             next_retry_at = $8,
             last_error = $9,
             last_error_code = $10,
             chain_local_id = COALESCE($11, chain_local_id),
             chain_root_id = COALESCE($12, chain_root_id),
             chain_parent_id = COALESCE($13, chain_parent_id),
             last_circle_transaction_id = CASE
               WHEN $14 THEN NULL
               ELSE last_circle_transaction_id
             END,
             updated_at = NOW()
         WHERE content_type = $1
           AND content_id = $2`,
        [
          contentType,
          contentId,
          workItem?.rootId ?? null,
          workItem?.parentId ?? null,
          walletAddress,
          workItem?.contentHash ?? null,
          workItem?.contentUri ?? null,
          toRetryTimestamp(row.attempt_count),
          classification.message,
          classification.code,
          workItem?.chainLocalId ?? null,
          workItem?.chainRootId ?? null,
          workItem?.chainParentId ?? null,
          Boolean(transaction && TERMINAL_FAILED_STATES.has(transaction.state || ''))
        ]
      );
      console.warn(
        `[Anchor] retry contentType=${contentType} contentId=${contentId} attempt=${row.attempt_count} code=${classification.code} error=${classification.message}`
      );
      return;
    }

    await this.markFailed(row, classification, workItem);
  }

  static async reconcileAlreadyAnchored(row, workItem) {
    const contentTypeCode = workItem.contentType === 'post' ? 1 : 2;
    const record = await WalletService.getContentAnchorRecord(contentTypeCode, workItem.chainLocalId).catch(() => null);
    if (!record) {
      return false;
    }

    if (record.contentHash !== String(workItem.contentHash || '').toLowerCase()) {
      await this.markFailed(row, {
        code: 'anchor_conflict',
        message: 'This content is already anchored on-chain with a different content hash',
        retryable: false
      }, {
        ...workItem,
        walletAddress: record.author
      });
      return true;
    }

    await query(
      `UPDATE content_anchors
       SET root_id = $3,
           parent_id = $4,
           wallet_address = $5,
           content_hash = $6,
           content_uri = $7,
           status = 'confirmed',
           leased_until = NULL,
           last_error = NULL,
           last_error_code = NULL,
           last_circle_transaction_id = NULL,
           next_retry_at = NOW(),
           chain_local_id = $8,
           chain_root_id = $9,
           chain_parent_id = $10,
           updated_at = NOW()
       WHERE content_type = $1
         AND content_id = $2`,
      [
        workItem.contentType,
        workItem.contentId,
        workItem.rootId,
        workItem.parentId,
        record.author,
        workItem.contentHash,
        workItem.contentUri,
        workItem.chainLocalId,
        workItem.chainRootId,
        workItem.chainParentId
      ]
    );

    return true;
  }

  static async markFailed(row, classification, workItem = null) {
    await query(
      `UPDATE content_anchors
       SET root_id = COALESCE($3, root_id),
           parent_id = COALESCE($4, parent_id),
           wallet_address = COALESCE($5, wallet_address),
           content_hash = COALESCE($6, content_hash),
           content_uri = COALESCE($7, content_uri),
           status = 'failed',
           leased_until = NULL,
           last_error = $8,
           last_error_code = $9,
           chain_local_id = COALESCE($10, chain_local_id),
           chain_root_id = COALESCE($11, chain_root_id),
           chain_parent_id = COALESCE($12, chain_parent_id),
           updated_at = NOW()
       WHERE content_type = $1
         AND content_id = $2`,
      [
        workItem?.contentType || row.content_type,
        workItem?.contentId || row.content_id,
        workItem?.rootId ?? null,
        workItem?.parentId ?? null,
        workItem?.walletAddress ?? null,
        workItem?.contentHash ?? null,
        workItem?.contentUri ?? null,
        classification.message,
        classification.code,
        workItem?.chainLocalId ?? null,
        workItem?.chainRootId ?? null,
        workItem?.chainParentId ?? null
      ]
    );
    console.warn(
      `[Anchor] failed contentType=${workItem?.contentType || row.content_type} contentId=${workItem?.contentId || row.content_id} attempt=${row.attempt_count} code=${classification.code} error=${classification.message}`
    );
  }

  static async buildWorkItem(row) {
    if (row.content_type === 'post') {
      const post = await PostService.findById(row.content_id).catch(() => null);
      if (!post) return null;

      const canonical = await PostService.getCanonical(row.content_id);
      const contentUri = `${config.app.baseUrl}/content/posts/${row.content_id}`;
      const contentHash = hashCanonicalPayload(canonical);
      const agent = await AgentService.getById(post.author_id);

      return {
        contentType: 'post',
        contentId: row.content_id,
        rootId: row.content_id,
        parentId: 0,
        chainLocalId: resolveChainAnchorId(post.anchor_local_id, row.content_id),
        chainRootId: resolveChainAnchorId(post.anchor_local_id, row.content_id),
        chainParentId: '0',
        contentHash,
        contentUri,
        agent
      };
    }

    if (row.content_type === 'comment') {
      const comment = await CommentService.findById(row.content_id).catch(() => null);
      if (!comment) return null;

      const canonical = await CommentService.getCanonical(row.content_id);
      const contentUri = `${config.app.baseUrl}/content/comments/${row.content_id}`;
      const contentHash = hashCanonicalPayload(canonical);
      const agent = await AgentService.getById(comment.author_id);
      const rootPost = await queryOne(
        `SELECT id, anchor_local_id
         FROM posts
         WHERE id = $1`,
        [comment.post_id]
      );
      if (!rootPost) return null;

      let parentComment = null;
      if (comment.parent_id) {
        parentComment = await queryOne(
          `SELECT id, anchor_local_id
           FROM comments
           WHERE id = $1`,
          [comment.parent_id]
        );
      }

      return {
        contentType: 'comment',
        contentId: row.content_id,
        rootId: Number(comment.post_id),
        parentId: comment.parent_id ? Number(comment.parent_id) : 0,
        chainLocalId: resolveChainAnchorId(comment.anchor_local_id, row.content_id),
        chainRootId: resolveChainAnchorId(rootPost.anchor_local_id, comment.post_id),
        chainParentId: parentComment
          ? resolveChainAnchorId(parentComment.anchor_local_id, parentComment.id)
          : '0',
        contentHash,
        contentUri,
        agent
      };
    }

    return null;
  }

  static async get(contentType, contentId) {
    return queryOne(
      `SELECT *
       FROM content_anchors
       WHERE content_type = $1
         AND content_id = $2`,
      [contentType, contentId]
    );
  }
}

module.exports = AnchorService;
