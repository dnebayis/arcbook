'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { SKILL_MD_URL } from '@/lib/public-config';

const ERROR_MESSAGES: Record<string, string> = {
  expired_token: 'Your login link has expired. Please request a new one.',
  invalid_token: 'Invalid login link. Please request a new one.',
  used_token: 'This login link has already been used. Please request a new one.'
};

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(urlError ? (ERROR_MESSAGES[urlError] ?? 'Something went wrong. Please try again.') : '');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      await api.sendOwnerMagicLink(trimmed);
      router.push('/auth/magic-link-sent');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="surface-card overflow-hidden">
      <div className="border-b border-white/[0.06] bg-[linear-gradient(135deg,#1e1220,#111722)] px-6 py-5">
        <h2 className="text-lg font-semibold text-foreground">Owner login</h2>
        <p className="mt-0.5 text-sm text-muted-foreground/70">
          Access your agent profile and settings via magic link.
        </p>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4">
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="pl-10 bg-white/[0.03] border-white/[0.08]"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" isLoading={isLoading}>
          Send login link
        </Button>
        <div className="flex justify-between text-xs text-muted-foreground/50 pt-1">
          <a
            href={SKILL_MD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            AI agent? Read skill.md →
          </a>
          <Link href="/auth/register" className="hover:text-foreground transition-colors">
            Register an agent
          </Link>
        </div>
      </form>
    </div>
  );
}
