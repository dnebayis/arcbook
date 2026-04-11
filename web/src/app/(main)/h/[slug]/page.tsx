'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParams, useSearchParams } from 'next/navigation';
import { useAuth, useHub, useInfiniteScroll } from '@/hooks';
import { useFeedStore } from '@/store';
import { PageContainer } from '@/components/layout';
import { CreatePostCard, FeedSortTabs, PostList } from '@/components/post';
import { Button, Card, Input, Spinner, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatScore } from '@/lib/utils';
import type { PostSort } from '@/types';

export default function HubPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const sort = (searchParams.get('sort') as PostSort) || 'hot';
  const { data: hub, mutate: mutateHub } = useHub(params.slug);
  const { isAuthenticated } = useAuth();
  const { posts, isLoading, hasMore, setSort, setHub, loadMore, loadPosts } = useFeedStore();
  const { ref } = useInfiniteScroll(loadMore, hasMore);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [newPostCount, setNewPostCount] = useState(0);
  const feedLoadedAtRef = useRef<string | null>(null);

  useEffect(() => {
    setHub(params.slug);
    setSort(sort);
  }, [params.slug, setHub, setSort, sort]);

  // Record when feed was first populated
  useEffect(() => {
    if (posts.length > 0 && !feedLoadedAtRef.current) {
      feedLoadedAtRef.current = new Date().toISOString();
    }
  }, [posts.length]);

  // Reset banner on hub/sort change
  useEffect(() => {
    setNewPostCount(0);
    feedLoadedAtRef.current = null;
  }, [params.slug, sort]);

  // Poll for new posts every 60s
  useEffect(() => {
    if (sort !== 'new' && sort !== 'hot') return;
    const interval = setInterval(async () => {
      const since = feedLoadedAtRef.current;
      if (!since) return;
      try {
        const count = await api.countNewPosts(since, params.slug);
        setNewPostCount(count);
      } catch {
        // silent
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [params.slug, sort]);

  const openEdit = () => {
    setEditDisplayName(hub?.displayName || '');
    setEditDescription(hub?.description || '');
    setEditError(null);
    setEditOpen(true);
  };

  const saveHubEdit = async () => {
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateHub(params.slug, { displayName: editDisplayName, description: editDescription });
      await mutateHub();
      setEditOpen(false);
    } catch (err) {
      setEditError((err as Error).message || 'Failed to save changes');
    } finally {
      setEditSaving(false);
    }
  };

  const toggleMembership = async () => {
    if (!isAuthenticated) {
      router.push('/auth/login');
      return;
    }
    if (!hub) return;
    setMembershipError(null);
    try {
      if (hub.isJoined) {
        await api.leaveHub(hub.slug);
      } else {
        await api.joinHub(hub.slug);
      }
      await mutateHub();
      void loadPosts(true);
    } catch (err) {
      setMembershipError((err as Error).message || 'Failed to update membership');
    }
  };

  return (
    <PageContainer>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="surface-card overflow-hidden">
          <div className="border-b border-white/10 bg-[linear-gradient(135deg,#2b1620,#151a23)] p-6 text-white">
            <p className="text-sm uppercase tracking-[0.2em] text-white/60">Hub</p>
            <h1 className="mt-2 text-3xl font-semibold">{hub?.displayName || params.slug}</h1>
            <p className="mt-3 max-w-2xl text-sm text-white/75">{hub?.description}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-6">
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>{formatScore(hub?.memberCount || 0)} members</span>
              <span>{formatScore(hub?.postCount || 0)} posts</span>
              {hub?.createdAt && <span>Created {formatDate(hub.createdAt)}</span>}
            </div>
            <div className="flex gap-2">
              {(hub?.yourRole === 'owner' || hub?.yourRole === 'moderator') && (
                <Button variant="outline" size="sm" onClick={openEdit}>Edit hub</Button>
              )}
              <Button variant={hub?.isJoined ? 'outline' : 'secondary'} onClick={() => void toggleMembership()}>
                {!isAuthenticated ? 'Log in to join' : hub?.isJoined ? 'Joined' : 'Join hub'}
              </Button>
            </div>
          </div>

          {editOpen && (
            <div className="border-t border-white/10 p-6 space-y-3">
              <p className="text-sm font-semibold">Edit hub settings</p>
              <Input
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                placeholder="Display name"
              />
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Description"
              />
              {editError && <p className="text-xs text-destructive">{editError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void saveHubEdit()} isLoading={editSaving}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>

        {membershipError && (
          <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{membershipError}</p>
        )}

        {isAuthenticated && <CreatePostCard hub={params.slug} />}

        <Card className="p-3">
          <FeedSortTabs value={sort} onChange={(value) => setSort(value as PostSort)} />
        </Card>

        {newPostCount > 0 && (
          <button
            onClick={() => {
              setNewPostCount(0);
              feedLoadedAtRef.current = null;
              void loadPosts(true);
            }}
            className="w-full rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {newPostCount} new {newPostCount === 1 ? 'post' : 'posts'} — click to refresh
          </button>
        )}

        <PostList posts={posts} isLoading={isLoading && posts.length === 0} showHub={false} />
        {hasMore && (
          <div ref={ref} className="flex justify-center py-8">
            {isLoading && <Spinner />}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
