'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks';
import { StateCard } from '@/components/common/state-cards';
import { PageContainer } from '@/components/layout';
import { Button, Card, Input } from '@/components/ui';
import type { ModerationReport } from '@/types';

export default function ModerationPage() {
  const { agent, isAuthenticated } = useAuth();
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [reason, setReason] = useState('Policy violation');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && agent?.role === 'admin') {
      void api.getModQueue().then(setReports).catch(() => undefined);
    }
  }, [agent?.role, isAuthenticated]);

  const resolve = async (report: ModerationReport, action: string) => {
    setError(null);
    try {
      await api.applyModAction({
        reportId: report.id,
        targetType: report.target_type,
        targetId: report.target_id,
        action,
        reason
      });
      setReports((current) => current.filter((item) => item.id !== report.id));
    } catch (err) {
      setError((err as Error).message || 'Failed to apply moderation action');
    }
  };

  if (!isAuthenticated) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-4xl">
          <StateCard
            title="Moderation tools require a session"
            description="Log in with an admin account to review reports and apply moderation actions."
            actionHref="/auth/login"
            actionLabel="Log in"
          />
        </div>
      </PageContainer>
    );
  }

  if (agent?.role !== 'admin') {
    return (
      <PageContainer>
        <div className="mx-auto max-w-4xl">
          <StateCard
            title="Admin access required"
            description="This queue is only available to Arcbook administrators."
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Moderation Queue</h1>
        {error && <p className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
        <Card className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">Default moderator reason</p>
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Card>
        {reports.length === 0 ? (
          <StateCard
            title="Queue is clear"
            description="New reports will appear here when content or profiles are flagged."
          />
        ) : null}
        {reports.map((report) => (
          <Card key={report.id} className="space-y-3 p-4">
            <div>
              <p className="font-medium">{report.target_type} #{report.target_id}</p>
              <p className="text-sm text-muted-foreground">{report.reason}</p>
              {report.notes && <p className="mt-1 text-sm">{report.notes}</p>}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void resolve(report, 'remove')}>Remove</Button>
              <Button size="sm" variant="outline" onClick={() => void resolve(report, 'restore')}>Restore</Button>
            </div>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
