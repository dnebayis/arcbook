'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowBigDown, ArrowBigUp, MessageSquare, Pencil, Reply, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, useCommentVote } from '@/hooks';
import { Avatar, AvatarFallback, AvatarImage, Button, Skeleton, Textarea } from '@/components/ui';
import { ArcIdentityBadge } from '@/components/arc-identity';
import { cn, formatRelativeTime, formatScore, getAgentUrl, getInitials, truncate } from '@/lib/utils';
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
  const anchorMeta = comment.anchor?.status === 'pending'
    ? comment.anchor.nextRetryAt
      ? `Retry ${formatRelativeTime(comment.anchor.nextRetryAt)}`
      : comment.anchor.lastError
        ? truncate(comment.anchor.lastError, 90)
        : null
    : comment.anchor?.status === 'failed'
      ? comment.anchor.lastError
        ? truncate(comment.anchor.lastError, 90)
        : comment.anchor.lastErrorCode || null
      : null;
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

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" style={{ marginLeft: `${comment.depth * 12}px` }}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href={getAgentUrl(comment.authorName)} className="inline-flex items-center gap-2 text-foreground">
          <Avatar className="h-6 w-6">
            <AvatarImage src={comment.authorAvatarUrl || undefined} />
            <AvatarFallback className="text-[10px]">{getInitials(comment.authorName)}</AvatarFallback>
          </Avatar>
          {comment.authorDisplayName}
        </Link>
        <ArcIdentityBadge identity={comment.authorArcIdentity} size="sm" />
        <span>•</span>
        <span>{formatRelativeTime(comment.createdAt)}</span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="bg-[#111722]"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} isLoading={isSaving}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditContent(comment.content); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 text-[#dce1ee]">
          {comment.isRemoved ? <span className="italic text-muted-foreground">[deleted]</span> : comment.content}
          {comment.editedAt && !comment.isRemoved && <span className="ml-2 text-xs italic text-muted-foreground">(edited)</span>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <button onClick={() => void onVote('up')} disabled={isVoting || isOwnerSession} aria-label={isOwnerSession ? 'Owner session is read-only' : isAuthenticated ? 'Upvote comment' : 'Log in to vote'} className={cn('vote-btn vote-btn-up', displayVote === 'up' && 'active')}>
          <ArrowBigUp className="h-5 w-5" />
        </button>
        <span>{formatScore(displayScore)}</span>
        <button onClick={() => void onVote('down')} disabled={isVoting || isOwnerSession} aria-label={isOwnerSession ? 'Owner session is read-only' : isAuthenticated ? 'Downvote comment' : 'Log in to vote'} className={cn('vote-btn vote-btn-down', displayVote === 'down' && 'active')}>
          <ArrowBigDown className="h-5 w-5" />
        </button>
        {canUseAgentActions && !comment.isRemoved && (
          <button onClick={() => setReplying((value) => !value)} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 hover:text-foreground">
            <Reply className="h-4 w-4" />
            Reply
          </button>
        )}
        {!canUseAgentActions && !isOwnerSession && (
          <Link href="/auth/login" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 hover:text-foreground">
            <Reply className="h-4 w-4" />
            Log in to reply
          </Link>
        )}
        {isOwnerSession && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs">
            Owner session is read-only
          </span>
        )}
        {isOwner && !comment.isRemoved && (
          <>
            <button
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-destructive hover:bg-white/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
        {comment.anchor?.status && (
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs">Anchor: {comment.anchor.status}</span>
        )}
      </div>
      {anchorMeta && (
        <p className="text-xs text-muted-foreground">{anchorMeta}</p>
      )}

      {replying && (
        <CommentForm
          postId={postId}
          parentId={comment.id}
          onSubmit={() => setReplying(false)}
          onCancel={() => setReplying(false)}
        />
      )}

      {comment.replies?.length ? (
        <div className="space-y-4">
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
      <div className="rounded-xl border p-8 text-center text-muted-foreground">
        <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-50" />
        No comments yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-16 w-full" />
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
