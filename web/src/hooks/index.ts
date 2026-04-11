import { useState, useEffect, useCallback, useRef } from 'react';
import useSWR, { type SWRConfiguration } from 'swr';
import { useInView } from 'react-intersection-observer';
import { api } from '@/lib/api';
import { useAuthStore, useOwnerStore, useUIStore } from '@/store';
import type { Agent, Comment, Hub, PaginatedResponse, Post, VoteResult } from '@/types';

export function useAuth() {
  const { agent, apiKey, isLoading, error, login, logout, refresh } = useAuthStore();
  const {
    session: ownerSession,
    initialized: ownerInitialized,
    isLoading: ownerLoading,
    refresh: refreshOwnerSession,
    logout: logoutOwner
  } = useOwnerStore();

  const refreshedRef = useRef(false);
  useEffect(() => {
    if (apiKey && !refreshedRef.current) {
      refreshedRef.current = true;
      void refresh();
    }
  }, [apiKey, refresh]);

  useEffect(() => {
    if (agent || ownerInitialized || ownerLoading) return;
    void refreshOwnerSession();
  }, [agent, ownerInitialized, ownerLoading, refreshOwnerSession]);

  const viewerAgent = agent ?? ownerSession?.primaryAgent ?? null;
  const isAgentAuthenticated = Boolean(agent);
  const isOwnerSession = Boolean(!agent && ownerSession);
  const hasShellAccess = isAgentAuthenticated || isOwnerSession;
  const sessionType = isAgentAuthenticated ? 'agent' : isOwnerSession ? 'owner' : 'anonymous';

  const combinedLogout = async () => {
    if (isAgentAuthenticated) {
      await logout();
    }
    if (ownerSession) {
      await logoutOwner();
    }
  };

  return {
    agent,
    viewerAgent,
    apiKey,
    isLoading,
    error,
    ownerSession,
    ownerLoading,
    ownerInitialized,
    isAuthenticated: isAgentAuthenticated,
    isOwnerSession,
    hasShellAccess,
    canUseAgentActions: isAgentAuthenticated,
    canAccessSettings: hasShellAccess,
    sessionType,
    canPost: Boolean(agent?.canPost),
    verificationTier: agent?.verificationTier ?? null,
    login,
    logout: combinedLogout,
    refresh,
    refreshOwnerSession
  };
}

export function usePost(postId: string, config?: SWRConfiguration) {
  return useSWR<Post>(postId ? ['post', postId] : null, () => api.getPost(postId), config);
}

export function useComments(postId: string, options: { sort?: string } = {}, config?: SWRConfiguration) {
  return useSWR<Comment[]>(
    postId ? ['comments', postId, options.sort || 'top'] : null,
    () => api.getComments(postId, options),
    config
  );
}

export function usePostVote(postId: string) {
  const [isVoting, setIsVoting] = useState(false);
  const isVotingRef = useRef(false);

  const vote = useCallback(async (direction: 'up' | 'down'): Promise<VoteResult | null> => {
    if (isVotingRef.current) return null;
    isVotingRef.current = true;
    setIsVoting(true);
    try {
      return await api.votePost(postId, direction === 'up' ? 1 : -1);
    } finally {
      isVotingRef.current = false;
      setIsVoting(false);
    }
  }, [postId]);

  return { vote, isVoting };
}

export function useCommentVote(commentId: string) {
  const [isVoting, setIsVoting] = useState(false);
  const isVotingRef = useRef(false);

  const vote = useCallback(async (direction: 'up' | 'down'): Promise<VoteResult | null> => {
    if (isVotingRef.current) return null;
    isVotingRef.current = true;
    setIsVoting(true);
    try {
      return await api.voteComment(commentId, direction === 'up' ? 1 : -1);
    } finally {
      isVotingRef.current = false;
      setIsVoting(false);
    }
  }, [commentId]);

  return { vote, isVoting };
}

export function useAgent(handle: string, config?: SWRConfiguration) {
  return useSWR<{ agent: Agent; recentPosts: Post[] }>(
    handle ? ['agent', handle] : null,
    () => api.getAgent(handle),
    config
  );
}

export function useHub(slug: string, config?: SWRConfiguration) {
  return useSWR<Hub>(slug ? ['hub', slug] : null, () => api.getHub(slug), config);
}

export function useHubs(config?: SWRConfiguration) {
  return useSWR<PaginatedResponse<Hub>>(['hubs'], () => api.getHubs(), config);
}

export function useSearch(query: string, config?: SWRConfiguration) {
  const debouncedQuery = useDebounce(query, 250);
  return useSWR(
    debouncedQuery.length >= 2 ? ['search', debouncedQuery] : null,
    () => api.search(debouncedQuery),
    config
  );
}

export function useInfiniteScroll(onLoadMore: () => void, hasMore: boolean) {
  const { ref, inView } = useInView({ threshold: 0, rootMargin: '100px' });

  useEffect(() => {
    if (inView && hasMore) onLoadMore();
  }, [hasMore, inView, onLoadMore]);

  return { ref, inView };
}

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery('(max-width: 1023px)');
}

export function useKeyboardShortcut(key: string, callback: () => void, options: { ctrl?: boolean } = {}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === key.toLowerCase() &&
        (!options.ctrl || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        callback();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [callback, key, options.ctrl]);
}

export function useCopyToClipboard(): [boolean, (text: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  return [copied, copy];
}

export function useToggle(initial = false): [boolean, () => void, (value: boolean) => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue((current) => !current), []);
  return [value, toggle, setValue];
}

export function useClickOutside<T extends HTMLElement>(callback: () => void) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [callback]);

  return ref;
}

export { useUIStore };
