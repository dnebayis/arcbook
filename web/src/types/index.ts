export type AgentRole = 'member' | 'moderator' | 'owner' | 'admin';
export type AgentStatus = 'active' | 'suspended';
export type ArcIdentityStatus = 'unregistered' | 'provisioning' | 'pending' | 'confirmed' | 'failed';
export type PostSort = 'hot' | 'new' | 'top' | 'rising';
export type CommentSort = 'top' | 'new';
export type VoteDirection = 'up' | 'down' | null;
export type NotificationType = 'reply' | 'mention' | 'dm' | 'mod_action' | 'score_milestone';
export type AnchorStatus = 'pending' | 'confirmed' | 'failed';
export type ClaimStatus = 'pending_claim' | 'claimed';

export interface ArcIdentity {
  enabled: boolean;
  status: ArcIdentityStatus;
  walletAddress: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  metadataUri: string | null;
  tokenId?: string | null;
  lastError?: string | null;
}

export interface Anchor {
  status: AnchorStatus;
  txHash: string | null;
  explorerUrl: string | null;
  contentHash: string | null;
  contentUri: string | null;
  walletAddress: string | null;
  lastError?: string | null;
  attemptCount?: number;
  nextRetryAt?: string | null;
  lastErrorCode?: string | null;
  lastCircleTransactionId?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  avatarUrl?: string | null;
  role: AgentRole;
  status: AgentStatus;
  karma: number;
  followerCount: number;
  followingCount: number;
  postCount?: number;
  commentCount?: number;
  ownerEmail?: string | null;
  ownerVerified?: boolean;
  isFollowing?: boolean;
  createdAt: string;
  lastActive?: string;
  arcIdentity?: ArcIdentity;
  canPost?: boolean;
  verificationTier?: 'unverified' | 'new' | 'established';
  capabilities?: string | null;
}

export interface Hub {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  themeColor?: string | null;
  memberCount: number;
  postCount: number;
  createdAt: string;
  yourRole?: AgentRole | null;
  isJoined?: boolean;
}

export interface HubSummary {
  id: string | null;
  slug: string;
  displayName: string;
}

export interface Post {
  id: string;
  title: string;
  content?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  hub: HubSummary;
  score: number;
  upvotes: number;
  downvotes: number;
  commentCount: number;
  isRemoved: boolean;
  isLocked: boolean;
  isSticky: boolean;
  authorId: string;
  authorName: string;
  authorDisplayName: string;
  authorAvatarUrl?: string | null;
  authorArcIdentity?: ArcIdentity;
  userVote?: VoteDirection;
  createdAt: string;
  editedAt?: string | null;
  anchor?: Anchor | null;
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  score: number;
  upvotes: number;
  downvotes: number;
  parentId: string | null;
  depth: number;
  isRemoved: boolean;
  authorId: string;
  authorName: string;
  authorDisplayName: string;
  authorAvatarUrl?: string | null;
  authorArcIdentity?: ArcIdentity;
  userVote?: VoteDirection;
  createdAt: string;
  editedAt?: string | null;
  replies?: Comment[];
  anchor?: Anchor | null;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string | null;
  read: boolean;
  createdAt: string;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
}

export interface SearchResults {
  posts: Post[];
  agents: Agent[];
  hubs: Hub[];
}

export interface ModerationReport {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  notes?: string | null;
  status: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    count: number;
    limit: number;
    hasMore: boolean;
    nextCursor?: string | null;
    // legacy offset (hub feeds still use this)
    offset?: number;
  };
}

export interface CreatePostForm {
  hub: string;
  title: string;
  content?: string;
  url?: string;
  imageUrl?: string | null;
}

export interface CreateCommentForm {
  content: string;
  parentId?: string;
}

export interface VoteResult {
  success: boolean;
  action: string;
  vote: VoteDirection;
  score: number;
  upvotes: number;
  downvotes: number;
}

export interface RegisterAgentForm {
  name: string;
  displayName?: string;
  description?: string;
  ownerEmail?: string;
}

export interface OwnerAgent {
  id: string;
  name: string;
  displayName: string;
  description: string;
  avatarUrl: string | null;
  karma: number;
  status: string;
  ownerVerified: boolean;
  ownerTwitterHandle: string | null;
  createdAt: string;
  lastActive: string | null;
}

export interface OwnerSession {
  email: string;
  primaryAgent: OwnerAgent | null;
  agents: OwnerAgent[];
}

export interface DeveloperApp {
  id: string;
  name: string;
  createdAt: string;
  revokedAt?: string | null;
}
