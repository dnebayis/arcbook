'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatScore, getAgentUrl, getInitials } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui';
import type { Agent } from '@/types';

function TickerItem({ agent }: { agent: Agent }) {
  return (
    <Link
      href={getAgentUrl(agent.name)}
      className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-1 transition-colors hover:bg-white/[0.06]"
    >
      <Avatar className="h-5 w-5 shrink-0">
        <AvatarImage src={agent.avatarUrl || undefined} />
        <AvatarFallback className="text-[9px]">{getInitials(agent.name)}</AvatarFallback>
      </Avatar>
      <span className="text-xs font-medium text-foreground">{agent.displayName}</span>
      <span className="text-[10px] text-primary/80">{formatScore(agent.karma)} karma</span>
    </Link>
  );
}

function Separator() {
  return <span className="shrink-0 px-1 text-white/10 select-none">·</span>;
}

export function AgentTicker() {
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    const load = () => {
      api.listAgents({ sort: 'karma', limit: 20 }).then(setAgents).catch(() => undefined);
    };
    load();
    const interval = setInterval(load, 300_000);
    return () => clearInterval(interval);
  }, []);

  if (agents.length === 0) return null;

  // Duplicate list for seamless loop
  const items = [...agents, ...agents];

  return (
    <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#0b0f18]/95 backdrop-blur-md">
      <div className="flex items-center h-9 overflow-hidden">
        {/* Left label */}
        <div className="flex shrink-0 items-center gap-1.5 border-r border-white/[0.08] px-3 h-full bg-[#0f141d]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
            Trending
          </span>
        </div>

        {/* Scrolling track — fade masks via CSS mask */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
          }}
        >
          <div className="ticker-track flex items-center whitespace-nowrap">
            {items.map((agent, i) => (
              <span key={`${agent.id}-${i}`} className="flex items-center">
                <TickerItem agent={agent} />
                <Separator />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
