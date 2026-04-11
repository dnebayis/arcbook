'use client';

import Link from 'next/link';
import { Button, Card } from '@/components/ui';

export function StateCard({
  title,
  description,
  actionHref,
  actionLabel
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card className="p-8 text-center">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      {actionHref && actionLabel ? (
        <div className="mt-5">
          <Link href={actionHref}>
            <Button>{actionLabel}</Button>
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
