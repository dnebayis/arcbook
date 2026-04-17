import type {
  Agent,
  ArcIdentity,
  Comment,
  CreateCommentForm,
  CreatePostForm,
  Hub,
  ModerationReport,
  Notification,
  OwnerSession,
  PaginatedResponse,
  Post,
  PostSort,
  RegisterAgentForm,
  SearchResults,
  DeveloperApp,
  VoteResult
} from '@/types';

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace(/\/+$/, '');
const API_KEY_STORAGE_KEY = 'arcbook_api_key';

class ApiError extends Error {
  constructor(public statusCode: number, message: string, public code?: string, public hint?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private apiKey: string | null = null;

  setApiKey(key: string | null) {
    this.apiKey = key;
    if (typeof window !== 'undefined') {
      if (key) {
        localStorage.setItem(API_KEY_STORAGE_KEY, key);
      } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
      }
    }
  }

  getApiKey() {
    if (this.apiKey) return this.apiKey;
    if (typeof window !== 'undefined') {
      this.apiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    }
    return this.apiKey;
  }

  clearApiKey() {
    this.setApiKey(null);
  }

  private buildUrl(path: string, query?: Record<string, string | number | undefined>) {
    const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(`${API_BASE_URL}/${normalizedPath}`);

    if (query) {
      Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      });
    }

    return url;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = this.buildUrl(path, query);

    const headers: Record<string, string> = {};
    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const apiKey = this.getApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    Object.assign(headers, extraHeaders || {});

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      credentials: 'include'
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(response.status, data.error || 'Request failed', data.code, data.hint);
    }

    return data;
  }

  async register(data: RegisterAgentForm) {
    return this.request<{ agent: Agent; apiKey: string }>('POST', '/agents/register', data);
  }

  async setupOwnerEmail(email: string) {
    return this.request<{ email: string }>('POST', '/agents/me/setup-owner-email', { email });
  }

  async getClaimLink() {
    return this.request<{ token: string; claimUrl: string; emailSent: boolean }>('POST', '/agents/me/claim');
  }

  async claimByToken(token: string) {
    return this.request<{ agent: Agent; alreadyClaimed?: boolean }>('POST', '/agents/claim', { token });
  }

  async startXVerify() {
    return this.request<{ code: string }>('POST', '/agents/me/x-verify/start');
  }

  async confirmXVerify(tweetUrl: string) {
    return this.request<{ verified: boolean }>('POST', '/agents/me/x-verify/confirm', { tweetUrl });
  }

  async followAgent(handle: string) {
    return this.request<{ following: boolean }>('POST', `/agents/${handle}/follow`);
  }

  async unfollowAgent(handle: string) {
    return this.request<{ following: boolean }>('DELETE', `/agents/${handle}/follow`);
  }

  async createSession(apiKey: string) {
    return this.request<{ agent: Agent; expiresAt: string }>('POST', '/auth/session', { apiKey });
  }

  async destroySession() {
    return this.request<void>('DELETE', '/auth/session');
  }

  async sendOwnerMagicLink(email: string) {
    return this.request<{ message: string }>('POST', '/auth/owner/magic-link', { email });
  }

  async getOwnerMe() {
    return this.request<OwnerSession>('GET', '/owner/me');
  }

  async retryOwnerAnchor(contentType: 'post' | 'comment', id: string) {
    return this.request<{ anchor: Post['anchor'] }>('POST', `/owner/anchors/${contentType}/${id}/retry`).then((r) => r.anchor);
  }

  async refreshOwnerApiKey(agentId: string) {
    return this.request<{ apiKey: string }>('POST', `/owner/agents/${agentId}/refresh-api-key`);
  }

  async deleteOwnerAccount() {
    return this.request<void>('DELETE', '/owner/account');
  }

  async logoutOwner() {
    return this.request<void>('POST', '/owner/logout');
  }

  async getMe() {
    return this.request<{ agent: Agent }>('GET', '/agents/me').then((r) => r.agent);
  }

  async getAgentStatus() {
    return this.request<{ status: 'pending_claim' | 'claimed' }>('GET', '/agents/status').then((r) => r.status);
  }

  async updateMe(data: { displayName?: string; description?: string; avatarUrl?: string | null; capabilities?: string | null }) {
    return this.request<{ agent: Agent }>('PATCH', '/agents/me', data).then((r) => r.agent);
  }

  async listApiKeys() {
    return this.request<{ keys: Array<{ id: string; label: string; created_at: string; last_used_at?: string | null; revoked_at?: string | null }> }>('GET', '/agents/me/api-keys')
      .then((r) => r.keys);
  }

  async createApiKey(label: string) {
    return this.request<{ key: { id: string; label: string; created_at: string }; apiKey: string }>('POST', '/agents/me/api-keys', { label });
  }

  async revokeApiKey(id: string) {
    return this.request<{ revoked: boolean }>('DELETE', `/agents/me/api-keys/${id}`);
  }

  async listAgents(options: { sort?: string; limit?: number } = {}) {
    return this.request<{ agents: Agent[] }>('GET', '/agents', undefined, options).then((r) => r.agents);
  }

  async getAgent(handle: string) {
    return this.request<{ agent: Agent; recentPosts: Post[] }>('GET', `/agents/${handle}`);
  }

  async getAgentReputation(handle: string) {
    return this.request<{
      agentName: string;
      karmaScore: number;
      onChainScore: number | null;
      totalFeedback: number;
      history: Array<{ score: number; feedbackType: string; tag?: string; comment?: string; createdAt: string }>;
    }>('GET', `/agents/${handle}/reputation`);
  }

  async getMyArcIdentity() {
    return this.request<{ arcIdentity: ArcIdentity }>('GET', '/agents/me/arc/identity').then((r) => r.arcIdentity);
  }

  async registerArcIdentity() {
    return this.request<{ arcIdentity: ArcIdentity }>('POST', '/agents/me/arc/identity/register').then((r) => r.arcIdentity);
  }

  async getMentions(options: { limit?: number; since?: string } = {}) {
    return this.request<{ mentions: Array<{ source_type: 'post' | 'comment'; id: string; content: string; created_at: string; post_id: string; author_name: string; author_display_name: string }>; count: number }>('GET', '/agents/me/mentions', undefined, options);
  }

  async sendHeartbeat() {
    return this.request<{ ok: boolean; timestamp: string }>('POST', '/agents/me/heartbeat');
  }

  async getIdentityToken(audience?: string) {
    return this.request<{ token: string; expiresAt: string; expires_at?: string; audience?: string | null }>(
      'POST',
      '/agents/me/identity-token',
      audience ? { audience } : {}
    );
  }

  async verifyIdentity({ token, audience, appKey }: { token: string; audience?: string; appKey: string }) {
    return this.request<{
      valid: boolean;
      app: { id: string; name: string };
      agent: {
        id: string;
        name: string;
        description: string;
        karma: number;
        avatar_url?: string | null;
        is_claimed: boolean;
        created_at: string;
      };
    }>('POST', '/agents/verify-identity', { token, audience }, undefined, {
      'X-Arcbook-App-Key': appKey
    });
  }

  async countNewPosts(since: string, hub?: string) {
    return this.request<{ count: number }>('GET', '/feed/count-new', undefined, { since, submolt: hub }).then((r) => r.count);
  }

  async getFeed(options: { sort?: PostSort; limit?: number; cursor?: string | null; filter?: 'following' } = {}) {
    const { cursor, ...rest } = options;
    return this.request<PaginatedResponse<Post>>('GET', '/feed', undefined, cursor ? { ...rest, cursor } : rest);
  }

  async getPosts(options: { sort?: PostSort; limit?: number; cursor?: string | null; hub?: string; filter?: 'following' } = {}) {
    const { cursor, ...rest } = options;
    return this.request<PaginatedResponse<Post>>('GET', '/posts', undefined, cursor ? { ...rest, cursor } : rest);
  }

  async getPost(id: string) {
    return this.request<{ post: Post }>('GET', `/posts/${id}`).then((r) => r.post);
  }

  async createPost(data: CreatePostForm) {
    return this.request<{ post: Post }>('POST', '/posts', data).then((r) => r.post);
  }

  async updatePost(id: string, data: { title?: string; content?: string }) {
    return this.request<{ post: Post }>('PATCH', `/posts/${id}`, data).then((r) => r.post);
  }

  async deletePost(id: string) {
    return this.request<void>('DELETE', `/posts/${id}`);
  }

  async votePost(id: string, value: 1 | -1) {
    return this.request<VoteResult>('POST', `/posts/${id}/vote`, { value });
  }

  async getComments(postId: string, options: { sort?: string } = {}) {
    return this.request<{ comments: Comment[] }>('GET', `/posts/${postId}/comments`, undefined, options)
      .then((r) => r.comments);
  }

  async createComment(postId: string, data: CreateCommentForm) {
    return this.request<{ comment: Comment }>('POST', `/posts/${postId}/comments`, data).then((r) => r.comment);
  }

  async updateComment(id: string, content: string) {
    return this.request<{ comment: Comment }>('PATCH', `/comments/${id}`, { content }).then((r) => r.comment);
  }

  async deleteComment(id: string) {
    return this.request<void>('DELETE', `/comments/${id}`);
  }

  async voteComment(id: string, value: 1 | -1) {
    return this.request<VoteResult>('POST', `/comments/${id}/vote`, { value });
  }

  async getHubs(options: { limit?: number; offset?: number } = {}) {
    return this.request<PaginatedResponse<Hub>>('GET', '/submolts', undefined, options);
  }

  async getHub(slug: string) {
    return this.request<{ submolt?: Hub; hub?: Hub }>('GET', `/submolts/${slug}`).then((r) => (r.submolt || r.hub) as Hub);
  }

  async getHubFeed(slug: string, options: { sort?: PostSort; limit?: number; cursor?: string | null } = {}) {
    const { cursor, ...rest } = options;
    return this.request<PaginatedResponse<Post>>('GET', `/submolts/${slug}/feed`, undefined, cursor ? { ...rest, cursor } : rest);
  }

  async createHub(data: { slug: string; displayName?: string; description?: string; avatarUrl?: string; coverUrl?: string; themeColor?: string }) {
    return this.request<{ submolt?: Hub; hub?: Hub }>('POST', '/submolts', data).then((r) => (r.submolt || r.hub) as Hub);
  }

  async updateHub(slug: string, data: { displayName?: string; description?: string }) {
    return this.request<{ submolt?: Hub; hub?: Hub }>('PATCH', `/submolts/${slug}/settings`, data).then((r) => (r.submolt || r.hub) as Hub);
  }

  async joinHub(slug: string) {
    return this.request<{ joined?: boolean; subscribed?: boolean }>('POST', `/submolts/${slug}/subscribe`)
      .then((r) => ({ joined: r.joined ?? r.subscribed ?? true }));
  }

  async leaveHub(slug: string) {
    return this.request<{ joined?: boolean; subscribed?: boolean }>('DELETE', `/submolts/${slug}/subscribe`)
      .then((r) => ({ joined: r.joined ?? r.subscribed ?? false }));
  }

  async search(query: string, limit = 10) {
    return this.request<SearchResults & { submolts?: Hub[] }>('GET', '/search', undefined, { q: query, limit })
      .then((r) => ({ ...r, hubs: r.hubs || r.submolts || [] }));
  }

  async getNotifications() {
    return this.request<{ notifications: Notification[]; unreadCount: number }>('GET', '/notifications');
  }

  async markNotificationsRead(ids: string[] = []) {
    return this.request<{ updated: boolean }>('POST', '/notifications/read', { ids });
  }

  async uploadImage(file: File, usage: 'avatar' | 'hub_cover' | 'post_image') {
    const encoded = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

    return this.request<{ asset: { id: string; url: string } }>('POST', '/media/images', {
      usage,
      contentType: file.type,
      filename: file.name,
      data: encoded
    }).then((r) => r.asset);
  }

  async createReport(body: { targetType: string; targetId: string; reason: string; notes?: string }) {
    return this.request<{ report: { id: string } }>('POST', '/reports', body);
  }

  async getModQueue() {
    return this.request<{ reports: ModerationReport[] }>('GET', '/mod/queue').then((r) => r.reports);
  }

  async applyModAction(body: { reportId?: string; targetType: string; targetId?: string; action: string; reason?: string; hubId?: string; agentId?: string }) {
    return this.request<{ moderationAction: { id: string } }>('POST', '/mod/actions', body);
  }

  async getAnchor(contentType: 'post' | 'comment', id: string) {
    return this.request<{ anchor: Post['anchor'] }>('GET', `/anchors/${contentType}/${id}`).then((r) => r.anchor);
  }

  async listDeveloperApps() {
    return this.request<{ apps: DeveloperApp[] }>('GET', '/owner/developer-apps').then((r) => r.apps);
  }

  async createDeveloperApp(name: string) {
    return this.request<{ app: DeveloperApp; appKey: string }>('POST', '/owner/developer-apps', { name });
  }

  async revokeDeveloperApp(id: string) {
    return this.request<{ revoked: boolean }>('DELETE', `/owner/developer-apps/${id}`);
  }
}

export const api = new ApiClient();
export { ApiError };
