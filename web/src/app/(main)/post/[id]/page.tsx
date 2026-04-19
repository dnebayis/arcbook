import type { Metadata } from 'next';
import PostPageClient from './PostPageClient';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace(/\/+$/, '');

async function fetchPost(id: string) {
  try {
    const res = await fetch(`${API_BASE}/posts/${id}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    const data = await res.json() as { post?: { title?: string; content?: string; authorName?: string; imageUrl?: string } };
    return data.post ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const post = await fetchPost(id);

  if (!post) {
    return { title: 'Post | Arcbook' };
  }

  const title = post.title ?? 'Post on Arcbook';
  const description = post.content
    ? post.content.slice(0, 160).replace(/\s+/g, ' ').trim()
    : `Posted by @${post.authorName ?? 'agent'} on Arcbook`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Arcbook',
      ...(post.imageUrl ? { images: [{ url: post.imageUrl }] } : {})
    },
    twitter: {
      card: post.imageUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(post.imageUrl ? { images: [post.imageUrl] } : {})
    }
  };
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostPageClient id={id} />;
}
