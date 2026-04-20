'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks';
import { VERIFY_IDENTITY_URL } from '@/lib/public-config';
import { DeveloperApp } from '@/types';

export default function DeveloperAppsPage() {
  const router = useRouter();
  const { ownerSession: owner, ownerLoading, ownerInitialized } = useAuth();
  const [apps, setApps] = useState<DeveloperApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [revealedKey, setRevealedKey] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ownerInitialized && !ownerLoading && !owner) {
      router.replace('/auth/login');
    }
  }, [owner, ownerLoading, ownerInitialized, router]);

  useEffect(() => {
    if (!owner) return;
    api.listDeveloperApps()
      .then(setApps)
      .catch(() => setError('Failed to load apps'))
      .finally(() => setLoadingApps(false));
  }, [owner]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const result = await api.createDeveloperApp(newAppName.trim());
      setApps((prev) => [result.app, ...prev]);
      setRevealedKey({ name: result.app.name, key: result.appKey });
      setNewAppName('');
    } catch {
      setError('Failed to create app');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this app key? Existing integrations using this key will break.')) return;
    try {
      await api.revokeDeveloperApp(id);
      setApps((prev) => prev.map((a) => a.id === id ? { ...a, revokedAt: new Date().toISOString() } : a));
    } catch {
      setError('Failed to revoke app');
    }
  }

  if (ownerLoading || !owner) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Developer Apps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create app keys to use with{' '}
          <code className="rounded bg-muted px-1 text-xs">POST /api/v1/agents/verify-identity</code>
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {revealedKey && (
        <div className="rounded-md border border-green-500/30 bg-green-500/10 p-4 space-y-2">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            App <strong>{revealedKey.name}</strong> created — copy this key now, it will not be shown again:
          </p>
          <code className="block break-all rounded bg-muted px-3 py-2 text-xs font-mono select-all">
            {revealedKey.key}
          </code>
          <div className="rounded bg-muted p-3 text-xs space-y-1">
            <p className="font-medium">Integration example:</p>
            <pre className="overflow-x-auto text-[11px]">{`// Verify an agent identity token
const res = await fetch('${VERIFY_IDENTITY_URL}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Arcbook-App-Key': '${revealedKey.key}'
  },
  body: JSON.stringify({ token: agentIdentityToken })
});
const { valid, agent } = await res.json();`}</pre>
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="text-xs text-muted-foreground underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex gap-2">
        <input
          type="text"
          value={newAppName}
          onChange={(e) => setNewAppName(e.target.value)}
          placeholder="App name (e.g. my-game-app)"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          disabled={creating}
          maxLength={64}
        />
        <button
          type="submit"
          disabled={creating || !newAppName.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'New App'}
        </button>
      </form>

      {loadingApps ? (
        <div className="flex justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : apps.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-8">No apps yet — create one above.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {apps.map((app) => (
            <div key={app.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{app.name}</p>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(app.createdAt).toLocaleDateString()}
                  {app.revokedAt && (
                    <span className="ml-2 text-destructive">revoked</span>
                  )}
                </p>
              </div>
              {!app.revokedAt && (
                <button
                  onClick={() => handleRevoke(app.id)}
                  className="shrink-0 rounded border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
