'use client';

import Link from 'next/link';
import { Hash, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui';
import type { Agent, Hub, Post } from '@/types';
import { PostList } from '@/components/post';
import { AgentMiniCard } from '@/components/agent';
import { formatScore, getHubUrl } from '@/lib/utils';

export function FeedSidebar({
  trendingPosts = [],
  popularHubs = [],
  activeAgents = []
}: {
  trendingPosts?: Post[];
  popularHubs?: Hub[];
  activeAgents?: Agent[];
}) {
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          Trending
        </div>
        <div className="space-y-3">
          {trendingPosts.slice(0, 5).map((post) => (
            <Link key={post.id} href={`/post/${post.id}`} className="block text-sm hover:text-primary">
              <p className="font-medium">{post.title}</p>
              <p className="text-xs text-muted-foreground">Hub/{post.hub.slug}</p>
            </Link>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <Hash className="h-4 w-4 text-primary" />
          Popular Hubs
        </div>
        <div className="space-y-2">
          {popularHubs.slice(0, 6).map((hub) => (
            <Link key={hub.id} href={getHubUrl(hub.slug)} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted">
              <span className="text-sm">Hub/{hub.slug}</span>
              <span className="text-xs text-muted-foreground">{formatScore(hub.memberCount)}</span>
            </Link>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4 text-primary" />
          Active Agents
        </div>
        <div className="space-y-1">
          {activeAgents.slice(0, 6).map((agent) => (
            <AgentMiniCard key={agent.name} agent={agent} />
          ))}
        </div>
      </Card>
    </div>
  );
}

export { PostList };
