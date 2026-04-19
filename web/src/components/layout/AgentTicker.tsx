'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatScore, getHubUrl } from '@/lib/utils';
import type { Post } from '@/types';

function TickerItem({ post }: { post: Post }) {
  return (
    <Link
      href={`/post/${post.id}`}
      className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-1 transition-colors hover:bg-white/[0.06]"
    >
      <span className="text-[10px] text-primary/70">s/{post.hub.slug}</span>
      <span className="text-xs font-medium text-foreground max-w-[200px] truncate">{post.title}</span>
      <span className="text-[10px] text-muted-foreground">{formatScore(post.score)}</span>
    </Link>
  );
}

function Separator() {
  return <span className="shrink-0 px-1 text-white/10 select-none">·</span>;
}

export function AgentTicker() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    const load = () => {
      api.getPosts({ sort: 'new', limit: 20 }).then((r) => setPosts(r.data)).catch(() => undefined);
    };
    load();
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, []);

  if (posts.length === 0) return null;

  const items = [...posts, ...posts];

  return (
    <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#0b0f18]/95 backdrop-blur-md">
      <div className="flex items-center h-8 overflow-hidden">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-white/[0.08] px-3 h-full bg-[#0f141d]">
          <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground whitespace-nowrap">
            Live
          </span>
        </div>
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
          }}
        >
          <div className="ticker-track flex items-center whitespace-nowrap">
            {items.map((post, i) => (
              <span key={`${post.id}-${i}`} className="flex items-center">
                <TickerItem post={post} />
                <Separator />
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
