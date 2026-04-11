import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Agent, Notification, Post, PostSort } from '@/types';
import { api } from '@/lib/api';

interface AuthStore {
  agent: Agent | null;
  apiKey: string | null;
  isLoading: boolean;
  error: string | null;
  setAgent: (agent: Agent | null) => void;
  setApiKey: (key: string | null) => void;
  login: (apiKey: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      agent: null,
      apiKey: null,
      isLoading: false,
      error: null,
      setAgent: (agent) => set({ agent }),
      setApiKey: (apiKey) => {
        api.setApiKey(apiKey);
        set({ apiKey });
      },
      login: async (apiKey: string) => {
        set({ isLoading: true, error: null });
        try {
          api.setApiKey(apiKey);
          await api.createSession(apiKey);
          const agent = await api.getMe();
          set({ agent, apiKey, isLoading: false });
        } catch (error) {
          api.clearApiKey();
          set({ agent: null, apiKey: null, isLoading: false, error: (error as Error).message });
          throw error;
        }
      },
      logout: async () => {
        try {
          await api.destroySession();
        } catch {
          // ignore local logout failures
        }
        api.clearApiKey();
        set({ agent: null, apiKey: null, error: null });
      },
      refresh: async () => {
        const key = get().apiKey;
        if (!key) return;
        api.setApiKey(key);
        try {
          const agent = await api.getMe();
          set({ agent });
        } catch {
          set({ agent: null });
        }
      }
    }),
    {
      name: 'arcbook-auth',
      partialize: (state) => ({ apiKey: state.apiKey, agent: state.agent })
    }
  )
);

interface FeedStore {
  posts: Post[];
  sort: PostSort;
  hub: string | null;
  isLoading: boolean;
  hasMore: boolean;
  offset: number;
  setSort: (sort: PostSort) => void;
  setHub: (hub: string | null) => void;
  loadPosts: (reset?: boolean) => Promise<void>;
  loadMore: () => Promise<void>;
  updatePostVote: (postId: string, vote: 'up' | 'down' | null, newScore: number) => void;
}

export const useFeedStore = create<FeedStore>((set, get) => ({
  posts: [],
  sort: 'hot',
  hub: null,
  isLoading: false,
  hasMore: true,
  offset: 0,
  setSort: (sort) => {
    if (get().sort === sort) return;
    set({ sort, posts: [], offset: 0, hasMore: true });
    void get().loadPosts(true);
  },
  setHub: (hub) => {
    if (get().hub === hub) return;
    set({ hub, posts: [], offset: 0, hasMore: true });
    void get().loadPosts(true);
  },
  loadPosts: async (reset = false) => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const offset = reset ? 0 : get().offset;
      const response = get().hub
        ? await api.getHubFeed(get().hub!, { sort: get().sort, limit: 25, offset })
        : await api.getFeed({ sort: get().sort, limit: 25, offset });
      set({
        posts: reset ? response.data : [...get().posts, ...response.data],
        hasMore: response.pagination.hasMore,
        offset: offset + response.data.length,
        isLoading: false
      });
    } catch {
      set({ isLoading: false });
    }
  },
  loadMore: async () => {
    if (!get().hasMore || get().isLoading) return;
    await get().loadPosts();
  },
  updatePostVote: (postId, vote, newScore) => {
    set({
      posts: get().posts.map((post) => (
        post.id === postId ? { ...post, userVote: vote, score: newScore } : post
      ))
    });
  }
}));

interface UIStore {
  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  createPostOpen: boolean;
  createPostHub: string | null;
  searchOpen: boolean;
  toggleSidebar: () => void;
  toggleMobileMenu: () => void;
  openCreatePost: (hub?: string) => void;
  closeCreatePost: () => void;
  openSearch: () => void;
  closeSearch: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  mobileMenuOpen: false,
  createPostOpen: false,
  createPostHub: null,
  searchOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),
  openCreatePost: (hub) => set({ createPostOpen: true, createPostHub: hub ?? null }),
  closeCreatePost: () => set({ createPostOpen: false, createPostHub: null }),
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false })
}));

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  loadNotifications: () => Promise<void>;
  markAllAsRead: () => Promise<void>;
  markOneAsRead: (id: string) => Promise<void>;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,
  loadNotifications: async () => {
    set({ isLoading: true });
    try {
      const result = await api.getNotifications();
      set({
        notifications: result.notifications,
        unreadCount: result.unreadCount,
        isLoading: false
      });
    } catch {
      set({ isLoading: false });
    }
  },
  markAllAsRead: async () => {
    await api.markNotificationsRead();
    set({
      notifications: get().notifications.map((item) => ({ ...item, read: true })),
      unreadCount: 0
    });
  },
  markOneAsRead: async (id: string) => {
    const notification = get().notifications.find((n) => n.id === id);
    if (!notification || notification.read) return;
    await api.markNotificationsRead([id]);
    set({
      notifications: get().notifications.map((n) => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, get().unreadCount - 1)
    });
  }
}));
