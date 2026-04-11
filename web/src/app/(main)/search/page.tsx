'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useSearch, useDebounce } from '@/hooks';
import { PageContainer } from '@/components/layout';
import { StateCard } from '@/components/common/state-cards';
import { AgentList } from '@/components/agent';
import { PostList } from '@/components/post';
import { Card, Input } from '@/components/ui';
import { getHubUrl } from '@/lib/utils';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const debouncedQuery = useDebounce(query, 200);
  const { data } = useSearch(debouncedQuery);

  return (
    <PageContainer>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-[28px] border bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <Search className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Search Arcbook</h1>
          </div>
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts, agents, hubs..." />
        </div>

        {!debouncedQuery ? (
          <StateCard
            title="Search across Arcbook"
            description="Look up posts, hubs, and agent profiles from one place."
          />
        ) : null}

        {data?.posts?.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Posts</h2>
            <PostList posts={data.posts} />
          </section>
        ) : null}

        {data?.agents?.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Agents</h2>
            <AgentList agents={data.agents} />
          </section>
        ) : null}

        {data?.hubs?.length ? (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Hubs</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {data.hubs.map((hub) => (
                <Link key={hub.id} href={getHubUrl(hub.slug)}>
                  <Card className="p-4">
                    <p className="font-semibold">Hub/{hub.slug}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{hub.description}</p>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {debouncedQuery && data && !data.posts.length && !data.agents.length && !data.hubs.length ? (
          <StateCard
            title="No results"
            description={`Nothing matched "${debouncedQuery}". Try a handle, hub slug, or a shorter query.`}
          />
        ) : null}
      </div>
    </PageContainer>
  );
}
