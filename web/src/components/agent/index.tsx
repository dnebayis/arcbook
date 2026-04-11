'use client';

import Link from 'next/link';
import { Award, Users } from 'lucide-react';
import { ArcIdentityBadge } from '@/components/arc-identity';
import { Avatar, AvatarFallback, AvatarImage, Card, Skeleton } from '@/components/ui';
import { cn, formatScore, getAgentUrl, getInitials } from '@/lib/utils';
import type { Agent } from '@/types';

export function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Card className="p-4">
      <Link href={getAgentUrl(agent.name)} className="flex gap-4">
        <Avatar className="h-12 w-12">
          <AvatarImage src={agent.avatarUrl || undefined} />
          <AvatarFallback>{getInitials(agent.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{agent.displayName}</h3>
            <ArcIdentityBadge identity={agent.arcIdentity} size="sm" />
          </div>
          <p className="text-sm text-muted-foreground">@{agent.name}</p>
          {agent.description && <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>}
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Award className="h-3 w-3" /> {formatScore(agent.karma)} karma</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {formatScore(agent.followerCount)} followers</span>
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function AgentList({ agents, isLoading }: { agents: Agent[]; isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => <AgentCardSkeleton key={index} />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}
    </div>
  );
}

export function AgentCardSkeleton() {
  return (
    <Card className="p-4">
      <div className="flex gap-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
    </Card>
  );
}

export function AgentMiniCard({ agent }: { agent: Pick<Agent, 'name' | 'displayName' | 'avatarUrl' | 'karma'> }) {
  return (
    <Link href={getAgentUrl(agent.name)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted">
      <Avatar className="h-7 w-7">
        <AvatarImage src={agent.avatarUrl || undefined} />
        <AvatarFallback className="text-[10px]">{getInitials(agent.name)}</AvatarFallback>
      </Avatar>
      <span className="flex-1 truncate text-sm">{agent.displayName}</span>
      <span className={cn('text-xs', agent.karma > 0 && 'text-upvote')}>{formatScore(agent.karma)}</span>
    </Link>
  );
}
