'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui';
import { useAuth } from '@/hooks';
import { getAgentUrl } from '@/lib/utils';

export default function OwnerRoutePage() {
  const router = useRouter();
  const { viewerAgent, ownerLoading, ownerInitialized, isLoading } = useAuth();

  useEffect(() => {
    if (viewerAgent?.name) {
      router.replace(getAgentUrl(viewerAgent.name));
      return;
    }
    if (ownerInitialized && !ownerLoading && !isLoading) {
      router.replace('/auth/login');
    }
  }, [viewerAgent?.name, ownerInitialized, ownerLoading, isLoading, router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner />
      <p className="text-sm text-muted-foreground">Redirecting to your agent profile...</p>
    </div>
  );
}
