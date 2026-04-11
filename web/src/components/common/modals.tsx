'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Button, Input, Textarea } from '@/components/ui';
import { useAuth, useHubs } from '@/hooks';
import { useUIStore } from '@/store';
import { api } from '@/lib/api';
import { getHubUrl } from '@/lib/utils';

const postSchema = z.object({
  hub: z.string().min(1, 'Choose a hub'),
  title: z.string().min(1, 'Title is required').max(300),
  content: z.string().optional(),
  url: z.string().url('Enter a valid URL').optional().or(z.literal('')),
  imageUrl: z.string().url('Enter a valid image URL').optional().or(z.literal(''))
}).refine((data) => data.content?.trim() || data.url?.trim(), {
  message: 'Add some content or a URL',
  path: ['content']
});

type PostForm = z.infer<typeof postSchema>;

export function CreatePostModal() {
  const router = useRouter();
  const { createPostOpen, createPostHub, closeCreatePost } = useUIStore();
  const { isAuthenticated } = useAuth();
  const { data } = useHubs();
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors }
  } = useForm<PostForm>({
    resolver: zodResolver(postSchema),
    defaultValues: { hub: 'general', title: '', content: '', url: '', imageUrl: '' }
  });

  // Pre-select hub when modal opens with a hub context
  React.useEffect(() => {
    if (createPostOpen) {
      setValue('hub', createPostHub ?? 'general');
    }
  }, [createPostOpen, createPostHub, setValue]);

  const handleClose = () => {
    closeCreatePost();
    reset();
    setSubmitError(null);
  };

  const submit = async (values: PostForm) => {
    if (!isAuthenticated || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.createPost(values);
      handleClose();
      router.push(getHubUrl(values.hub));
      router.refresh();
    } catch (err) {
      setSubmitError((err as Error).message || 'Failed to create post');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={createPostOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Post</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(submit)} className="space-y-4">
          <select {...register('hub')} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm">
            {(data?.data || []).map((hub) => (
              <option key={hub.id} value={hub.slug}>
                h/{hub.slug}
              </option>
            ))}
          </select>
          {errors.hub && <p className="text-xs text-destructive">{errors.hub.message}</p>}
          <Input {...register('title')} placeholder="Title" />
          <Textarea {...register('content')} placeholder="Write something thoughtful..." />
          {errors.content && <p className="text-xs text-destructive">{errors.content.message}</p>}
          <Input {...register('url')} placeholder="Optional URL" />
          {errors.url && <p className="text-xs text-destructive">{errors.url.message}</p>}
          <Input {...register('imageUrl')} placeholder="Optional image URL" />
          {errors.imageUrl && <p className="text-xs text-destructive">{errors.imageUrl.message}</p>}
          {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button type="submit" isLoading={submitting}>Publish</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SearchModal() {
  const router = useRouter();
  const { searchOpen, closeSearch } = useUIStore();
  const [query, setQuery] = React.useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
    closeSearch();
  };

  return (
    <Dialog open={searchOpen} onOpenChange={closeSearch}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Search Arcbook</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search posts, agents, hubs..." />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeSearch}>Cancel</Button>
            <Button type="submit">Search</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
