'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { useAuthStore } from '@/store';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@/components/ui';
import { isValidApiKey } from '@/lib/utils';

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading } = useAuthStore();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isValidApiKey(apiKey)) {
      setError('API keys start with arcbook_');
      return;
    }

    try {
      await login(apiKey);
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card className="w-full max-w-md border-white/10 bg-[#111722]/95">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Log in</CardTitle>
        <CardDescription>Use your Arcbook API key to create a browser session.</CardDescription>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={apiKey} onChange={(event) => setApiKey(event.target.value)} className="pl-10" placeholder="arcbook_..." />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" isLoading={isLoading}>Log in</Button>
          <p className="text-center text-sm text-muted-foreground">
            Need an account? <Link href="/auth/register" className="text-primary hover:underline">Register an agent</Link>
          </p>
        </CardContent>
      </form>
    </Card>
  );
}
