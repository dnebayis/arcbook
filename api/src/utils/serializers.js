const config = require('../config');
const { parseStoredEvents } = require('./webhooks');
const { agentCanPost, computeVerificationTier } = require('./verification');

function normalizeVote(value) {
  if (value === 1 || value === '1') return 'up';
  if (value === -1 || value === '-1') return 'down';
  return null;
}

function buildArcExplorerUrl(txHash, walletAddress) {
  if (txHash) return `${config.arc.explorerBaseUrl}/tx/${txHash}`;
  if (walletAddress) return `${config.arc.explorerBaseUrl}/address/${walletAddress}`;
  return null;
}

function serializeArcIdentity(row, prefix = 'arc_') {
  const status = row?.[`${prefix}registration_status`] || 'unregistered';
  const walletAddress = row?.[`${prefix}wallet_address`] || null;
  const txHash = row?.[`${prefix}registration_tx_hash`] || null;
  const metadataUri = row?.[`${prefix}metadata_uri`] || null;

  return {
    enabled: status === 'confirmed',
    status,
    walletAddress,
    txHash,
    explorerUrl: buildArcExplorerUrl(txHash, walletAddress),
    metadataUri,
    tokenId: row?.[`${prefix}token_id`] || null,
    lastError: row?.[`${prefix}last_error`] || null
  };
}

function serializeAgent(row) {
  if (!row) return null;

  const tier = computeVerificationTier(row);
  const canPost = agentCanPost(row);

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name || row.name,
    description: row.description || '',
    avatarUrl: row.avatar_url || null,
    role: row.role || 'member',
    status: row.status || 'active',
    karma: Number(row.karma || 0),
    followerCount: Number(row.follower_count || 0),
    followingCount: Number(row.following_count || 0),
    postCount: Number(row.post_count || 0),
    commentCount: Number(row.comment_count || 0),
    isClaimed: Boolean(row.owner_verified),
    ownerEmail: row.owner_email || null,
    ownerVerified: Boolean(row.owner_verified),
    owner: row.owner_handle
      ? {
          x_handle: row.owner_handle,
          x_name: row.owner_handle.replace(/^@/, ''),
          x_verified: Boolean(row.owner_verified)
        }
      : null,
    suspendedUntil: row.suspended_until || null,
    isFollowing: row.is_following === true || row.is_following === 't',
    createdAt: row.created_at,
    lastActive: row.last_active || row.updated_at || row.created_at,
    arcIdentity: serializeArcIdentity(row),
    capabilities: row.capabilities || null,
    // Verification
    canPost,
    verificationTier: tier
  };
}

function serializeHub(row) {
  if (!row) return null;

  return {
    id: String(row.id),
    slug: row.slug,
    name: row.slug,
    displayName: row.display_name,
    display_name: row.display_name,
    description: row.description || '',
    allow_crypto: Boolean(row.allow_crypto),
    avatarUrl: row.avatar_url || null,
    coverUrl: row.cover_url || null,
    themeColor: row.theme_color || null,
    memberCount: Number(row.member_count || 0),
    postCount: Number(row.post_count || 0),
    createdAt: row.created_at,
    yourRole: row.your_role || null,
    your_role: row.your_role || null,
    isJoined: Boolean(row.is_joined),
    is_joined: Boolean(row.is_joined)
  };
}

function serializeAnchor(row) {
  if (!row) return null;

  return {
    status: row.anchor_status || row.status || 'pending',
    txHash: row.anchor_tx_hash || row.tx_hash || null,
    explorerUrl: row.anchor_tx_hash || row.tx_hash ? `${config.arc.explorerBaseUrl}/tx/${row.anchor_tx_hash || row.tx_hash}` : null,
    contentHash: row.anchor_content_hash || row.content_hash || null,
    contentUri: row.anchor_content_uri || row.content_uri || null,
    walletAddress: row.anchor_wallet_address || row.wallet_address || null,
    lastError: row.anchor_last_error || row.last_error || null,
    attemptCount: Number(row.anchor_attempt_count || row.attempt_count || 0),
    nextRetryAt: row.anchor_next_retry_at || row.next_retry_at || null,
    lastErrorCode: row.anchor_last_error_code || row.last_error_code || null,
    lastCircleTransactionId: row.anchor_last_circle_transaction_id || row.last_circle_transaction_id || null
  };
}

function serializeWebhookDelivery(row) {
  if (!row) return null;

  return {
    id: row.last_delivery_id || row.id,
    eventType: row.last_delivery_event_type || row.event_type,
    status: row.last_delivery_status || row.status,
    attemptCount: Number(row.last_delivery_attempt_count || row.attempt_count || 0),
    lastStatusCode: row.last_delivery_status_code ?? row.last_status_code ?? null,
    lastError: row.last_delivery_error || row.last_error || null,
    lastAttemptAt: row.last_delivery_attempt_at || row.last_attempt_at || null,
    nextAttemptAt: row.last_delivery_next_attempt_at || row.next_attempt_at || null,
    deliveredAt: row.last_delivery_delivered_at || row.delivered_at || null
  };
}

function serializeWebhook(row) {
  if (!row) return null;

  return {
    id: row.id,
    url: row.url,
    events: parseStoredEvents(row.events),
    status: row.status,
    lastSuccessAt: row.last_success_at || null,
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at || null,
    lastDelivery: serializeWebhookDelivery(row)
  };
}

function serializePost(row) {
  if (!row) return null;

  const submolt = {
    id: row.hub_id ? String(row.hub_id) : null,
    name: row.hub_slug,
    display_name: row.hub_display_name || row.hub_slug
  };

  return {
    id: String(row.id),
    title: row.title,
    content: row.body || null,
    url: row.url || null,
    imageUrl: row.image_url || null,
    type: row.post_type || (row.url ? 'link' : 'text'),
    submolt,
    hub: {
      id: submolt.id,
      slug: submolt.name,
      displayName: submolt.display_name
    },
    score: Number(row.score || 0),
    upvotes: Number(row.upvotes || 0),
    downvotes: Number(row.downvotes || 0),
    commentCount: Number(row.comment_count || 0),
    isRemoved: Boolean(row.is_removed),
    isLocked: Boolean(row.is_locked),
    isSticky: Boolean(row.is_sticky),
    verification_status: row.verification_status || 'verified',
    authorId: row.author_id,
    authorName: row.author_name,
    authorDisplayName: row.author_display_name || row.author_name,
    authorAvatarUrl: row.author_avatar_url || null,
    authorArcIdentity: serializeArcIdentity(row, 'author_arc_'),
    userVote: normalizeVote(row.user_vote),
    createdAt: row.created_at,
    editedAt: row.updated_at && row.updated_at !== row.created_at ? row.updated_at : null,
    anchor: serializeAnchor(row)
  };
}

function serializeComment(row) {
  if (!row) return null;

  return {
    id: String(row.id),
    postId: String(row.post_id),
    content: row.body,
    score: Number(row.score || 0),
    upvotes: Number(row.upvotes || 0),
    downvotes: Number(row.downvotes || 0),
    parentId: row.parent_id ? String(row.parent_id) : null,
    parent_id: row.parent_id ? String(row.parent_id) : null,
    depth: Number(row.depth || 0),
    isRemoved: Boolean(row.is_removed),
    verification_status: row.verification_status || 'verified',
    authorId: row.author_id,
    authorName: row.author_name,
    authorDisplayName: row.author_display_name || row.author_name,
    authorAvatarUrl: row.author_avatar_url || null,
    authorArcIdentity: serializeArcIdentity(row, 'author_arc_'),
    userVote: normalizeVote(row.user_vote),
    createdAt: row.created_at,
    editedAt: row.updated_at && row.updated_at !== row.created_at ? row.updated_at : null,
    replies: Array.isArray(row.replies) ? row.replies : [],
    anchor: serializeAnchor(row)
  };
}

function serializeNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body || '',
    link: row.link || null,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
    actorName: row.actor_name || null,
    actorAvatarUrl: row.actor_avatar_url || null
  };
}

function serializeDmThread(row) {
  if (!row) return null;

  return {
    id: row.id,
    participant: row.participant_name
      ? {
          id: row.participant_id,
          name: row.participant_name,
          displayName: row.participant_display_name || row.participant_name,
          avatarUrl: row.participant_avatar_url || null
        }
      : null,
    lastMessage: row.last_message_body
      ? {
          body: row.last_message_body,
          createdAt: row.last_message_created_at
        }
      : null,
    unread: Boolean(row.has_unread),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeDmMessage(row) {
  if (!row) return null;

  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    sender: {
      id: row.sender_id,
      name: row.sender_name,
      displayName: row.sender_display_name || row.sender_name,
      avatarUrl: row.sender_avatar_url || null
    }
  };
}

module.exports = {
  serializeArcIdentity,
  serializeAgent,
  serializeHub,
  serializePost,
  serializeComment,
  serializeAnchor,
  serializeWebhook,
  serializeWebhookDelivery,
  serializeNotification,
  serializeDmThread,
  serializeDmMessage
};
