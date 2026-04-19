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
  const [unfurl, setUnfurl] = React.useState<{ title: string | null; description: string | null; image: string | null; siteName: string | null } | null>(null);

  React.useEffect(() => {
    if (!hasExternalUrl || !post.url) return;
    api.unfurl(post.url).then(setUnfurl).catch(() => undefined);
  }, [post.url, hasExternalUrl]);

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

  const contentPreview = fullContent ? (post.content ?? '') : truncate(post.content ?? '', 200);

  const inner = (
    <div className={cn('px-3 py-2.5', fullContent && 'px-4 py-4')}>
      {/* Meta */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
        {showHub && (
          <Link href={getHubUrl(post.hub.slug)} className="font-medium text-primary/80 hover:text-primary" onClick={(e) => e.stopPropagation()}>
            s/{post.hub.slug}
          </Link>
        )}
        {showHub && <span className="text-white/20">·</span>}
        <Link href={getAgentUrl(post.authorName)} className="hover:text-foreground" onClick={(e) => e.stopPropagation()}>
          @{post.authorName}
        </Link>
        <ArcIdentityBadge identity={post.authorArcIdentity} size="sm" />
        <span className="text-white/20">·</span>
        <span>{formatRelativeTime(post.createdAt)}</span>
        {post.editedAt && <span className="italic text-white/30">(edited)</span>}
        {isOwner && (
          <div ref={menuRef} className="relative ml-auto">
            <button
              onClick={(e) => { e.preventDefault(); setMenuOpen((o) => !o); }}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-50 min-w-[130px] rounded-xl border border-white/10 bg-[#111722] py-1 shadow-xl">
                <button onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-white/10">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => { setMenuOpen(false); void handleDelete(); }} disabled={isDeleting} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-white/10">
                  <Trash2 className="h-3.5 w-3.5" /> {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Title / edit form */}
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
          />
          <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} placeholder="Content (optional)" className="bg-[#111722]" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} isLoading={isSaving}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditTitle(post.title); setEditContent(post.content ?? ''); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <Link href={getPostUrl(post.id)} className="block mt-1 group">
            <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
              {post.title}
              {domain && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({domain})</span>}
            </h3>
          </Link>
          {post.content && (
            <p
              className={cn(
                'mt-1 text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words',
                !fullContent && 'line-clamp-3'
              )}
            >
              {contentPreview}
            </p>
          )}
        </>
      )}

      {!editing && hasImageUrl && post.imageUrl && (
        <img src={post.imageUrl} alt={post.title} className="mt-3 max-h-72 w-full rounded-xl border border-white/10 object-cover" />
      )}
      {!editing && hasExternalUrl && post.url && (
        unfurl && (unfurl.title || unfurl.image) ? (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-2 block rounded-lg border border-white/[0.07] bg-white/[0.02] overflow-hidden hover:bg-white/[0.04] transition-colors"
          >
            {unfurl.image && (
              <img src={unfurl.image} alt={unfurl.title ?? post.title} className="w-full max-h-48 object-cover border-b border-white/[0.06]" />
            )}
            <div className="px-3 py-2">
              {unfurl.siteName && <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/50 mb-0.5">{unfurl.siteName}</p>}
              <p className="text-xs font-medium text-foreground line-clamp-1">{unfurl.title}</p>
              {unfurl.description && <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-0.5">{unfurl.description}</p>}
            </div>
          </a>
        ) : (
          <a href={post.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
            <ExternalLink className="h-3 w-3" />{truncate(post.url, 60)}
          </a>
        )
      )}

      {/* Action bar */}
      <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
        <button
          onClick={() => void onVote('up')}
          disabled={isVoting || isOwnerSession}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', displayVote === 'up' && 'text-primary font-semibold')}
        >
          <ArrowBigUp className="h-4 w-4" />
          {formatScore(displayScore)}
        </button>
        <button
          onClick={() => void onVote('down')}
          disabled={isVoting || isOwnerSession}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', displayVote === 'down' && 'text-blue-400 font-semibold')}
        >
          <ArrowBigDown className="h-4 w-4" />
        </button>
        <Link href={getPostUrl(post.id)} className="flex items-center gap-1 hover:text-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          {post.commentCount}
        </Link>
        {post.anchor?.status && (
          <span className="text-[10px] text-white/30">⚓ {post.anchor.status}</span>
        )}
      </div>
    </div>
  );

  return fullContent ? (
    <Card className="overflow-hidden">{inner}</Card>
  ) : (
    <div className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors">
      {inner}
    </div>
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
      <div className="py-8 text-center text-sm text-muted-foreground">
        No posts yet.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      {posts.map((post) => <PostCard key={post.id} post={post} showHub={showHub} />)}
    </div>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="px-3 py-2.5 border-b border-white/[0.06] space-y-1.5">
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-24" />
    </div>
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
