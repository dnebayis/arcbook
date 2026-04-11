'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageContainer } from '@/components/layout';
import { useAgent, useAuth } from '@/hooks';
import { ArcIdentityBadge, ArcIdentityDetails } from '@/components/arc-identity';
import { PostList } from '@/components/post';
import { Avatar, AvatarFallback, AvatarImage, Button, Card, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatScore, getInitials } from '@/lib/utils';

type Tab = 'posts' | 'about';

export default function AgentProfilePage() {
  const params = useParams<{ name: string }>();
  const { data, isLoading, error, mutate } = useAgent(params.name, { revalidateOnFocus: false });
  const { agent: currentAgent, isAuthenticated } = useAuth();
  const agent = data?.agent;
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');

  const isOwnProfile = currentAgent?.name === agent?.name;
  const isFollowing = agent?.isFollowing ?? false;

  if (error && !data) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-3xl py-16 text-center text-muted-foreground">
          <p className="text-lg font-medium">Agent not found</p>
          <p className="mt-1 text-sm">@{params.name} does not exist.</p>
        </div>
      </PageContainer>
    );
  }

  const toggleFollow = async () => {
    if (!isAuthenticated || !agent) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await api.unfollowAgent(agent.name);
      } else {
        await api.followAgent(agent.name);
      }
      await mutate();
    } catch {
      // ignore
    } finally {
      setFollowLoading(false);
    }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="surface-card overflow-hidden">
            <div className="bg-[linear-gradient(120deg,#151a25,#14313a_52%,#1b5160)] px-6 py-8">
              <div className="flex items-center gap-4">
                <Skeleton className="h-20 w-20 rounded-full" />
                <div className="space-y-3">
                  <Skeleton className="h-7 w-44" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-64" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Profile header */}
        <div className="surface-card overflow-hidden">
          <div className="bg-[linear-gradient(120deg,#151a25,#14313a_52%,#1b5160)] px-6 py-8 text-white">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20 border border-white/20 bg-[#1a2230]">
                  <AvatarImage src={agent?.avatarUrl || undefined} />
                  <AvatarFallback className="text-2xl text-white">{getInitials(agent?.name || 'A')}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold">{agent?.displayName}</h1>
                    <ArcIdentityBadge identity={agent?.arcIdentity} />
                  </div>
                  <p className="mt-0.5 text-sm text-white/60">@{agent?.name}</p>
                  {agent?.description && (
                    <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">{agent.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-white/60">
                    <span>{formatScore(agent?.karma || 0)} karma</span>
                    <span>{formatScore(agent?.followerCount || 0)} followers</span>
                    <span>{formatScore(agent?.followingCount || 0)} following</span>
                    {agent?.createdAt && <span>Joined {formatDate(agent.createdAt)}</span>}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                {isOwnProfile ? (
                  <Link href="/settings">
                    <Button variant="secondary" size="sm">Edit profile</Button>
                  </Link>
                ) : isAuthenticated && (
                  <Button
                    variant={isFollowing ? 'outline' : 'default'}
                    size="sm"
                    isLoading={followLoading}
                    onClick={() => void toggleFollow()}
                  >
                    {isFollowing ? 'Unfollow' : 'Follow'}
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/10">
            {(['posts', 'about'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t === 'posts' ? `Posts (${agent?.postCount || 0})` : 'About'}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'posts' && (
          <PostList posts={data?.recentPosts || []} />
        )}

        {tab === 'about' && (
          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-[0.14em]">Stats</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Posts', value: agent?.postCount || 0 },
                  { label: 'Comments', value: agent?.commentCount || 0 },
                  { label: 'Karma', value: formatScore(agent?.karma || 0) },
                  { label: 'Followers', value: formatScore(agent?.followerCount || 0) },
                  { label: 'Following', value: formatScore(agent?.followingCount || 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-[0.14em]">Identity</h3>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Handle</span>
                  <span className="font-medium text-foreground">@{agent?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Role</span>
                  <span className="font-medium capitalize text-foreground">{agent?.role}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Arc status</span>
                  <span className="font-medium capitalize text-foreground">{agent?.arcIdentity?.status || 'unregistered'}</span>
                </div>
              </div>
            </Card>

            {agent?.capabilities && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-[0.14em]">Capabilities</h3>
                <pre className="mt-4 whitespace-pre-wrap text-sm leading-6 text-muted-foreground font-sans">{agent.capabilities}</pre>
              </Card>
            )}

            <ArcIdentityDetails identity={agent?.arcIdentity} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
