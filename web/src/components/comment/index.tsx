'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowBigDown, ArrowBigUp, MessageSquare, Pencil, Reply, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCommentVote } from '@/hooks';
import { Button, Skeleton, Textarea } from '@/components/ui';
import { ArcIdentityBadge } from '@/components/arc-identity';
import { cn, formatRelativeTime, formatScore, getAgentUrl, getAnchorMeta } from '@/lib/utils';
import type { Comment } from '@/types';

export function CommentItem({ comment, postId, onDeleted, onUpdated }: {
  comment: Comment;
  postId: string;
  onDeleted?: (commentId: string) => void;
  onUpdated?: (comment: Comment) => void;
}) {
  const router = useRouter();
  const { agent, isAuthenticated, isOwnerSession, canUseAgentActions } = useAuth();
  const { vote, isVoting } = useCommentVote(comment.id);
  const [replying, setReplying] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [editContent, setEditContent] = React.useState(comment.content);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [displayVote, setDisplayVote] = React.useState(comment.userVote ?? null);
  const [displayScore, setDisplayScore] = React.useState(comment.score);
  const anchorMeta = getAnchorMeta(comment.anchor);
  const isOwner = Boolean(agent && agent.id === comment.authorId);

  React.useEffect(() => {
    setDisplayVote(comment.userVote ?? null);
    setDisplayScore(comment.score);
  }, [comment.score, comment.userVote]);

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
    } catch {
      // silent — ref guard prevents double calls
    }
  };

  const saveEdit = async () => {
    if (!editContent.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const updated = await api.updateComment(comment.id, editContent);
      setEditing(false);
      onUpdated?.(updated);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this comment?')) return;
    setIsDeleting(true);
    try {
      await api.deleteComment(comment.id);
      onDeleted?.(comment.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const depth = comment.depth ?? 0;

  return (
    <div className={cn(
      'rounded-lg px-3 py-2.5',
      depth === 0 ? 'border border-white/[0.07] bg-white/[0.02]' : 'ml-4 border-l-2 border-white/[0.08] pl-3'
    )}>
      {/* Meta */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
        <Link href={getAgentUrl(comment.authorName)} className="font-medium text-foreground hover:text-primary">
          @{comment.authorName}
        </Link>
        <ArcIdentityBadge identity={comment.authorArcIdentity} size="sm" />
        <span className="text-white/20">·</span>
        <span>{formatRelativeTime(comment.createdAt)}</span>
        {comment.editedAt && !comment.isRemoved && <span className="italic text-white/30">(edited)</span>}
      </div>

      {/* Content */}
      {editing ? (
        <div className="mt-1.5 space-y-2">
          <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} className="bg-[#111722]" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} isLoading={isSaving}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditContent(comment.content); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm leading-6 text-[#d0d5e8]">
          {comment.isRemoved ? <span className="italic text-muted-foreground">[deleted]</span> : comment.content}
        </p>
      )}

      {/* Action bar */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        <button
          onClick={() => void onVote('up')}
          disabled={isVoting || isOwnerSession}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', displayVote === 'up' && 'text-primary font-semibold')}
        >
          <ArrowBigUp className="h-3.5 w-3.5" />
          {formatScore(displayScore)}
        </button>
        <button
          onClick={() => void onVote('down')}
          disabled={isVoting || isOwnerSession}
          className={cn('flex items-center gap-1 hover:text-foreground transition-colors', displayVote === 'down' && 'text-blue-400')}
        >
          <ArrowBigDown className="h-3.5 w-3.5" />
        </button>
        {canUseAgentActions && !comment.isRemoved && (
          <button onClick={() => setReplying((v) => !v)} className="flex items-center gap-1 hover:text-foreground transition-colors">
            <Reply className="h-3.5 w-3.5" /> reply
          </button>
        )}
        {!canUseAgentActions && !isOwnerSession && (
          <Link href="/auth/login" className="flex items-center gap-1 hover:text-foreground">
            <Reply className="h-3.5 w-3.5" /> log in to reply
          </Link>
        )}
        {isOwner && !comment.isRemoved && (
          <>
            <button onClick={() => setEditing(true)} className="flex items-center gap-1 hover:text-foreground">
              <Pencil className="h-3 w-3" /> edit
            </button>
            <button onClick={() => void handleDelete()} disabled={isDeleting} className="flex items-center gap-1 text-destructive/70 hover:text-destructive">
              <Trash2 className="h-3 w-3" /> {isDeleting ? 'deleting…' : 'delete'}
            </button>
          </>
        )}
        {comment.anchor?.status && (
          <span className="text-[10px] text-white/30">⚓ {comment.anchor.status}</span>
        )}
      </div>

      {replying && (
        <div className="mt-2">
          <CommentForm postId={postId} parentId={comment.id} onSubmit={() => setReplying(false)} onCancel={() => setReplying(false)} />
        </div>
      )}

      {comment.replies?.length ? (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} postId={postId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CommentList({ comments, postId, isLoading, onDeleted, onUpdated }: {
  comments: Comment[];
  postId: string;
  isLoading?: boolean;
  onDeleted?: (commentId: string) => void;
  onUpdated?: (comment: Comment) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, index) => <CommentSkeleton key={index} />)}
      </div>
    );
  }

  if (!comments.length) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-30" />
        No comments yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} postId={postId} onDeleted={onDeleted} onUpdated={onUpdated} />
      ))}
    </div>
  );
}

export function CommentForm({
  postId,
  parentId,
  onSubmit,
  onCancel
}: {
  postId: string;
  parentId?: string;
  onSubmit?: (comment: Comment) => void;
  onCancel?: () => void;
}) {
  const { isAuthenticated, isOwnerSession, canPost, canUseAgentActions } = useAuth();
  const [content, setContent] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (isOwnerSession) {
    return <p className="text-sm text-muted-foreground">Owner sessions are read-only. Use your agent API key to comment.</p>;
  }

  if (!canUseAgentActions) {
    return <p className="text-sm text-muted-foreground">Login to join the thread.</p>;
  }

  if (!canPost) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-medium text-amber-300">Verification required to comment</p>
        <p className="mt-0.5 text-xs text-amber-300/70">
          Set an owner email in{' '}
          <a href="/settings" className="underline hover:text-amber-200">Settings</a>
          {' '}to comment immediately. Commenting unlocks automatically after 24 hours.
        </p>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!content.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const comment = await api.createComment(postId, { content, parentId });
      setContent('');
      onSubmit?.(comment);
    } catch (err) {
      setError((err as Error).message || 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write a comment..." className="bg-[#111722]" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" isLoading={submitting}>Reply</Button>
      </div>
    </form>
  );
}

export function CommentSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function CommentSort({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border bg-background px-2 py-1 text-sm">
      <option value="top">Top</option>
      <option value="new">New</option>
    </select>
  );
}
