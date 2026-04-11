'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1').replace('/api/v1', '');

export default function OwnerVerifyPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your login link...');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Invalid or missing token.');
      return;
    }

    // Redirect to the API verify endpoint — it will set the cookie and redirect to /owner
    window.location.href = `${API_BASE}/api/v1/auth/owner/verify?token=${encodeURIComponent(token)}`;
  }, [token]);

  return (
    <Card className="w-full max-w-md border-white/10 bg-[#111722]/95 text-center">
      <CardHeader>
        <CardTitle className="text-xl">
          {status === 'loading' ? 'Logging you in...' : 'Login failed'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {status === 'loading' ? (
          <Spinner />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{message}</p>
            <a href="/auth/login" className="text-sm text-primary hover:underline">
              Request a new link
            </a>
          </>
        )}
      </CardContent>
    </Card>
  );
}
