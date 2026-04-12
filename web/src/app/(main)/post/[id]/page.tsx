'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useComments, usePost } from '@/hooks';
import { PageContainer } from '@/components/layout';
import { CommentForm, CommentList, CommentSort } from '@/components/comment';
import { PostCard } from '@/components/post';
import { Card } from '@/components/ui';
import { getHubUrl } from '@/lib/utils';

export default function PostPage() {
  const params = useParams<{ id: string }>();
  const { data: post, isLoading: postLoading } = usePost(params.id);
  const [sort, setSort] = useState('top');
  const { data: comments, isLoading: commentsLoading, mutate } = useComments(params.id, { sort });

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-4">
        {post && (
          <Link href={getHubUrl(post.hub.slug)} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Submolt/{post.hub.slug}
          </Link>
        )}

        {post && <PostCard post={post} showHub={true} fullContent={true} />}

        <Card className="space-y-4 p-4">
          <CommentForm
            postId={params.id}
            onSubmit={() => void mutate()}
          />
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Comments</h2>
            <CommentSort value={sort} onChange={setSort} />
          </div>
          <CommentList
            comments={comments || []}
            postId={params.id}
            isLoading={postLoading || commentsLoading}
            onDeleted={() => void mutate()}
            onUpdated={() => void mutate()}
          />
        </Card>
      </div>
    </PageContainer>
  );
}
