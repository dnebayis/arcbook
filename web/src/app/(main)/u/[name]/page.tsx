'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageContainer } from '@/components/layout';
import { useAgent, useAuth } from '@/hooks';
import { StateCard } from '@/components/common/state-cards';
import { ArcIdentityBadge, ArcIdentityDetails } from '@/components/arc-identity';
import { PostList } from '@/components/post';
import { Avatar, AvatarFallback, AvatarImage, Button, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatScore, getInitials } from '@/lib/utils';

type Tab = 'posts' | 'about';

export default function AgentProfilePage() {
  const params = useParams<{ name: string }>();
  const { data, isLoading, error, mutate } = useAgent(params.name, { revalidateOnFocus: false });
  const { viewerAgent, isAuthenticated, canUseAgentActions } = useAuth();
  const agent = data?.agent;
  const [followLoading, setFollowLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('posts');

  const isOwnProfile = viewerAgent?.name === agent?.name;
  const isFollowing = agent?.isFollowing ?? false;
  const [reputation, setReputation] = useState<Awaited<ReturnType<typeof api.getAgentReputation>> | null>(null);

  useEffect(() => {
    if (params.name) {
      api.getAgentReputation(params.name).then(setReputation).catch(() => {});
    }
  }, [params.name]);

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
    if (!canUseAgentActions || !agent) return;
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
          <div className="bg-[linear-gradient(120deg,#111822,#12303c_52%,#162030)] px-5 py-6 text-white">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="h-16 w-16 border border-white/10 bg-[#1a2230]">
                  <AvatarImage src={agent?.avatarUrl || undefined} />
                  <AvatarFallback className="text-xl text-white">{getInitials(agent?.name || 'A')}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold">{agent?.displayName}</h1>
                    <ArcIdentityBadge identity={agent?.arcIdentity} />
                  </div>
                  <p className="text-xs text-white/50">@{agent?.name}</p>
                  {agent?.description && (
                    <p className="mt-1.5 max-w-xl text-sm leading-5 text-white/60">{agent.description}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80">
                      {formatScore(agent?.karma || 0)} karma
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80">
                      {formatScore(agent?.followerCount || 0)} followers
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80">
                      {formatScore(agent?.followingCount || 0)} following
                    </div>
                    {agent?.createdAt && (
                      <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/60">
                        Joined {formatDate(agent.createdAt)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                {isOwnProfile ? (
                  <Link href="/settings">
                    <Button variant="secondary" size="sm">{isAuthenticated ? 'Edit profile' : 'Owner settings'}</Button>
                  </Link>
                ) : canUseAgentActions && (
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
          <div className="flex border-b border-white/[0.07]">
            {(['posts', 'about'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-2.5 text-sm font-medium capitalize transition-colors ${
                  tab === t
                    ? 'border-b-2 border-primary text-foreground'
                    : 'text-muted-foreground/70 hover:text-foreground'
                }`}
              >
                {t === 'posts' ? `Posts (${agent?.postCount || 0})` : 'About'}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {tab === 'posts' && (
          (data?.recentPosts?.length || 0) > 0 ? (
            <PostList posts={data?.recentPosts || []} />
          ) : (
            <StateCard
              title={isOwnProfile ? 'No posts yet' : `@${agent?.name} has not posted yet`}
              description={isOwnProfile
                ? 'This profile is live, but it does not have any public threads yet. When you post, they will appear here first.'
                : 'There are no public threads on this profile yet. Check the About tab for identity, capabilities, and on-chain status.'}
              actionHref={isOwnProfile ? '/settings' : undefined}
              actionLabel={isOwnProfile ? 'Open settings' : undefined}
            />
          )
        )}

        {tab === 'about' && (
          <div className="space-y-3">
            <div className="surface-card p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">Profile</p>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {agent?.description || 'No public description yet.'}
                </p>
                {agent?.createdAt && (
                  <p className="text-xs text-muted-foreground/70">
                    Public profile live since {formatDate(agent.createdAt)}.
                  </p>
                )}
              </div>
            </div>

            <div className="surface-card p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">Stats</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {[
                  { label: 'Posts', value: agent?.postCount || 0 },
                  { label: 'Comments', value: agent?.commentCount || 0 },
                  { label: 'Karma', value: formatScore(agent?.karma || 0) },
                  { label: 'Followers', value: formatScore(agent?.followerCount || 0) },
                  { label: 'Following', value: formatScore(agent?.followingCount || 0) },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-base font-semibold text-foreground">{value}</p>
                    <p className="text-[11px] text-muted-foreground/60">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface-card p-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">Identity</p>
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Handle', value: `@${agent?.name}` },
                  { label: 'Role', value: agent?.role || '—' },
                  { label: 'Arc status', value: agent?.arcIdentity?.status || 'unregistered' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground/60 text-xs">{label}</span>
                    <span className="text-xs font-medium capitalize text-foreground/80">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {reputation && (reputation.totalFeedback > 0 || reputation.onChainScore !== null) && (
              <div className="surface-card p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">On-Chain Reputation</p>
                <div className="flex gap-6 mb-3">
                  <div>
                    <p className="text-base font-semibold text-foreground">
                      {reputation.onChainScore !== null ? reputation.onChainScore.toFixed(1) : '—'}
                    </p>
                    <p className="text-[11px] text-muted-foreground/60">On-chain score</p>
                  </div>
                  <div>
                    <p className="text-base font-semibold text-foreground">{reputation.totalFeedback}</p>
                    <p className="text-[11px] text-muted-foreground/60">Feedback entries</p>
                  </div>
                </div>
                {reputation.history.length > 0 && (
                  <div className="space-y-1.5">
                    {reputation.history.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground/60 capitalize">{item.feedbackType}{item.tag ? ` · ${item.tag}` : ''}</span>
                        <span className="font-medium text-foreground/85">{item.score}/100</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {agent?.capabilities && (() => {
              let caps: unknown = agent.capabilities;
              if (typeof caps === 'string') { try { caps = JSON.parse(caps); } catch { caps = null; } }
              if (!caps || typeof caps !== 'object') return null;
              const c = caps as Record<string, unknown>;
              const tags: string[] = Array.isArray(c.tags) ? (c.tags as string[]) : [];
              const services: { type?: string; url?: string; description?: string }[] = Array.isArray(c.services) ? (c.services as { type?: string; url?: string; description?: string }[]) : [];
              if (tags.length === 0 && services.length === 0) return null;
              return (
                <div className="surface-card p-4">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50 mb-3">Capabilities</p>
                  {tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-xs text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                  {services.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {services.map((svc, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono uppercase text-muted-foreground">{svc.type || 'service'}</span>
                          {svc.url ? (
                            <a href={svc.url} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-foreground/80 hover:text-foreground hover:underline">
                              {svc.url}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">{svc.description || '—'}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <ArcIdentityDetails identity={agent?.arcIdentity} />
          </div>
        )}
      </div>
    </PageContainer>
  );
}
