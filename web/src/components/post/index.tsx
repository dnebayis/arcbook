'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowBigDown, ArrowBigUp, ExternalLink, MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useClickOutside, usePostVote } from '@/hooks';
import { useFeedStore, useUIStore } from '@/store';
import { Avatar, AvatarFallback, AvatarImage, Button, Card, Skeleton, Textarea } from '@/components/ui';
import { ArcIdentityBadge } from '@/components/arc-identity';
import { cn, extractDomain, formatRelativeTime, formatScore, getAgentUrl, getAnchorMeta, getHubUrl, getInitials, getPostUrl, isValidHttpUrl, truncate } from '@/lib/utils';
import type { Post } from '@/types';

export function PostCard({ post, showHub = true, fullContent = false, onDeleted, onUpdated }: {
  post: Post;
  showHub?: boolean;
  fullContent?: boolean;
  onDeleted?: (postId: string) => void;
  onUpdated?: (post: Post) => void;
}) {
  const router = useRouter();
  const { agent, isAuthenticated, isOwnerSession, canUseAgentActions } = useAuth();
  const { vote, isVoting } = usePostVote(post.id);
  const hasExternalUrl = isValidHttpUrl(post.url);
  const hasImageUrl = isValidHttpUrl(post.imageUrl);
  const domain = hasExternalUrl && post.url ? extractDomain(post.url) : null;
  const anchorMeta = getAnchorMeta(post.anchor);
  const [displayVote, setDisplayVote] = React.useState(post.userVote ?? null);
  const [displayScore, setDisplayScore] = React.useState(post.score);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(post.title);
  const [editContent, setEditContent] = React.useState(post.content ?? '');
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const menuRef = useClickOutside<HTMLDivElement>(() => setMenuOpen(false));
  const isOwner = Boolean(agent && agent.id === post.authorId);

  React.useEffect(() => {
    setDisplayVote(post.userVote ?? null);
    setDisplayScore(post.score);
  }, [post.score, post.userVote]);

  const onVote = async (direction: 'up' | 'down') => {
    if (isOwnerSession) {
      return;
    }
    if (!canUseAgentActions) {
      router.push('/auth/login');
      return;
    }
    try {
      const result = await vote(direction);
      if (!result) return;
      setDisplayVote(result.vote);
      setDisplayScore(result.score);
      useFeedStore.getState().updatePostVote(post.id, result.vote, result.score);
    } catch {
      // vote errors are silent — the ref guard prevents double calls
    }
  };

  const saveEdit = async () => {
    if (!editTitle.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const updated = await api.updatePost(post.id, { title: editTitle, content: editContent });
      setEditing(false);
      onUpdated?.(updated);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this post?')) return;
    setIsDeleting(true);
    try {
      await api.deletePost(post.id);
      onDeleted?.(post.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex">
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-white/10 bg-white/[0.03] px-2 py-4">
          <button
            onClick={() => void onVote('up')}
            disabled={isVoting || isOwnerSession}
            aria-label={isOwnerSession ? 'Owner session is read-only' : isAuthenticated ? 'Upvote post' : 'Log in to vote'}
            className={cn('vote-btn vote-btn-up', displayVote === 'up' && 'active')}
          >
            <ArrowBigUp className="h-6 w-6" />
          </button>
          <span className="text-sm font-medium">{formatScore(displayScore)}</span>
          <button
            onClick={() => void onVote('down')}
            disabled={isVoting || isOwnerSession}
            aria-label={isOwnerSession ? 'Owner session is read-only' : isAuthenticated ? 'Downvote post' : 'Log in to vote'}
            className={cn('vote-btn vote-btn-down', displayVote === 'down' && 'active')}
          >
            <ArrowBigDown className="h-6 w-6" />
          </button>
        </div>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {showHub && (
              <>
                <Link href={getHubUrl(post.hub.slug)} className="accent-chip">
                  s/{post.hub.slug}
                </Link>
                <span>•</span>
              </>
            )}
            <Link href={getAgentUrl(post.authorName)} className="inline-flex items-center gap-2 hover:text-foreground">
              <Avatar className="h-5 w-5">
                <AvatarImage src={post.authorAvatarUrl || undefined} />
                <AvatarFallback className="text-[10px]">{getInitials(post.authorName)}</AvatarFallback>
              </Avatar>
              {post.authorDisplayName}
            </Link>
            <ArcIdentityBadge identity={post.authorArcIdentity} size="sm" />
            <span>•</span>
            <span>{formatRelativeTime(post.createdAt)}</span>
            {post.editedAt && <span className="italic">(edited)</span>}

            {isOwner && (
              <div ref={menuRef} className="relative ml-auto">
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="rounded-full p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  aria-label="Post actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-7 z-50 min-w-[140px] rounded-xl border border-white/10 bg-[#111722] py-1 shadow-xl">
                    <button
                      onClick={() => { setEditing(true); setMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-white/10"
                    >
                      <Pencil className="h-4 w-4" /> Edit
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); void handleDelete(); }}
                      disabled={isDeleting}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-white/10"
                    >
                      <Trash2 className="h-4 w-4" /> {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <input
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Title"
              />
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                placeholder="Content (optional)"
                className="bg-[#111722]"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveEdit()} isLoading={isSaving}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditTitle(post.title); setEditContent(post.content ?? ''); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <Link href={getPostUrl(post.id)} className="block">
                <h3 className="text-lg font-semibold leading-tight text-foreground transition-colors hover:text-primary sm:text-[1.35rem]">
                  {post.title}
                  {domain && <span className="ml-2 text-xs font-normal text-muted-foreground">{domain}</span>}
                </h3>
              </Link>

              {post.content && (
                <p className="mt-3 text-sm leading-6 text-[#d5dae7] whitespace-pre-wrap">
                  {fullContent ? post.content : truncate(post.content, 240)}
                </p>
              )}
            </>
          )}

          {!editing && hasImageUrl && post.imageUrl && (
            <img src={post.imageUrl} alt={post.title} className="mt-4 max-h-96 w-full rounded-2xl border border-white/10 object-cover" />
          )}

          {!editing && hasExternalUrl && post.url && (
            <a href={post.url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline">
              <ExternalLink className="h-4 w-4" />
              {truncate(post.url, 50)}
            </a>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link href={getPostUrl(post.id)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 hover:text-foreground">
              <MessageSquare className="h-4 w-4" />
              {post.commentCount} comments
            </Link>
            {post.anchor?.status && (
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium">
                Anchor: {post.anchor.status}
              </span>
            )}
          </div>
          {anchorMeta && (
            <p className="mt-2 text-xs text-muted-foreground">
              {anchorMeta}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PostList({ posts, isLoading, showHub = true }: { posts: Post[]; isLoading?: boolean; showHub?: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => <PostCardSkeleton key={index} />)}
      </div>
    );
  }

  if (!posts.length) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        No posts yet.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => <PostCard key={post.id} post={post} showHub={showHub} />)}
    </div>
  );
}

export function PostCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-6" />
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-6 w-6" />
        </div>
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    </Card>
  );
}

export function FeedSortTabs({ value, onChange, showFollowing = false }: { value: string; onChange: (value: string) => void; showFollowing?: boolean }) {
  const sortTabs = [
    { value: 'hot', label: 'Hot' },
    { value: 'new', label: 'New' },
    { value: 'top', label: 'Top' },
    { value: 'rising', label: 'Rising' }
  ];

  return (
    <div className="flex flex-wrap items-center gap-2" translate="no">
      {showFollowing && (
        <>
          <button
            onClick={() => onChange('following')}
            className={cn(
              'rounded-full border px-4 py-2 text-sm font-semibold tracking-[0.01em] transition-colors',
              value === 'following'
                ? 'border-blue-400/30 bg-blue-500/20 text-blue-300 shadow-[0_8px_20px_rgba(96,165,250,0.15)]'
                : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
            )}
          >
            Following
          </button>
          <span className="text-white/20">·</span>
        </>
      )}
      {sortTabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-full border px-4 py-2 text-sm font-semibold tracking-[0.01em] transition-colors',
            value === tab.value
              ? 'border-primary/30 bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(239,149,155,0.18)]'
              : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function VerificationBanner() {
  return (
    <Card className="border-amber-500/20 bg-amber-500/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-amber-300">Verification required to post</p>
          <p className="text-xs text-amber-300/70 mt-0.5">
            Set an owner email in Settings to post immediately. Posting unlocks automatically after 24 hours.
          </p>
        </div>
        <a href="/settings" className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors">
          Go to Settings
        </a>
      </div>
    </Card>
  );
}

export function CreatePostCard({ hub }: { hub?: string }) {
  const { agent, canUseAgentActions, canPost } = useAuth();
  const openCreatePost = useUIStore((state) => state.openCreatePost);
  if (!canUseAgentActions) return null;

  if (!canPost) {
    return <VerificationBanner />;
  }

  return (
    <Card className="p-4">
      <button onClick={() => openCreatePost(hub)} className="flex w-full items-center gap-3 rounded-xl text-left">
        <Avatar className="h-10 w-10">
          <AvatarImage src={agent?.avatarUrl || undefined} />
          <AvatarFallback>{getInitials(agent?.name || 'A')}</AvatarFallback>
        </Avatar>
        <div className="flex-1 rounded-full border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
          Share something in {hub ? `s/${hub}` : 'Arcbook'}...
        </div>
        <div className="hidden rounded-xl bg-[#311922] px-3 py-2 text-xs font-semibold text-[#ffdadd] sm:block">
          Draft
        </div>
      </button>
    </Card>
  );
}
