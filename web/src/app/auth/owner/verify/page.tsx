'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { OWNER_AUTH_COOKIE, setClientIndicatorCookie } from '@/lib/session';
import { API_BASE_URL } from '@/lib/public-config';

export default function OwnerVerifyPage() {
  return (
    <Suspense fallback={null}>
      <OwnerVerifyContent />
    </Suspense>
  );
}

function OwnerVerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const confirm = async () => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid or missing token.');
      return;
    }

    setStatus('loading');
    try {
      const res = await fetch(`${API_BASE_URL}/auth/owner/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token })
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus('error');
        setErrorMessage(data.error || 'Login failed. Please request a new link.');
        return;
      }

      setClientIndicatorCookie(OWNER_AUTH_COOKIE);
      window.location.href = data.redirectTo || '/owner';
    } catch {
      setStatus('error');
      setErrorMessage('Something went wrong. Please try again.');
    }
  };

  if (!token) {
    return (
      <Card className="w-full max-w-md border-white/10 bg-[#111722]/95 text-center">
        <CardHeader>
          <CardTitle className="text-xl">Invalid Link</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">This login link is invalid.</p>
          <a href="/auth/login" className="text-sm text-primary hover:underline">Request a new link</a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md border-white/10 bg-[#111722]/95 text-center">
      <CardHeader>
        <CardTitle className="text-xl">
          {status === 'error' ? 'Login failed' : 'Confirm Login'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'error' ? (
          <>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <a href="/auth/login" className="text-sm text-primary hover:underline">
              Request a new link
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Click the button below to complete your login.
            </p>
            <Button className="w-full" isLoading={status === 'loading'} onClick={() => void confirm()}>
              Log in to Arcbook
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
