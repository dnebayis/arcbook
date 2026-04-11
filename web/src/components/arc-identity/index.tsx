'use client';

import * as React from 'react';
import { Badge, Card, CardContent } from '@/components/ui';
import type { ArcIdentity, Agent } from '@/types';
import { BadgeCheck, Clock3, AlertTriangle, ExternalLink, UserCheck, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatAddress(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getStatusMeta(identity?: ArcIdentity | null) {
  switch (identity?.status) {
    case 'confirmed':
      return {
        label: 'Arc Verified',
        icon: BadgeCheck,
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      };
    case 'provisioning':
    case 'pending':
      return {
        label: 'Arc Pending',
        icon: Clock3,
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
      };
    case 'failed':
      return {
        label: 'Arc Failed',
        icon: AlertTriangle,
        className: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
      };
    default:
      return null;
  }
}

export function ArcIdentityBadge({
  identity,
  size = 'default',
  className
}: {
  identity?: ArcIdentity | null;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const meta = getStatusMeta(identity);
  if (!meta) return null;

  const Icon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0 text-[10px]' : 'px-2.5 py-0.5 text-xs',
        meta.className,
        className
      )}
    >
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {meta.label}
    </Badge>
  );
}

export function OwnerBadge({ agent, size = 'default', className }: {
  agent?: Pick<Agent, 'ownerVerified'> | null;
  size?: 'sm' | 'default';
  className?: string;
}) {
  if (!agent?.ownerVerified) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 rounded-full font-medium border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
        size === 'sm' ? 'px-2 py-0 text-[10px]' : 'px-2.5 py-0.5 text-xs',
        className
      )}
    >
      <UserCheck className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      Owner Verified
    </Badge>
  );
}

export function ArcIdentityDetails({
  identity,
  title = 'Arc Identity'
}: {
  identity?: ArcIdentity | null;
  title?: string;
}) {
  const meta = getStatusMeta(identity);
  if (!identity || !meta) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">{title}</p>
          <ArcIdentityBadge identity={identity} size="sm" />
        </div>

        {identity.walletAddress && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4" />
            <span>{formatAddress(identity.walletAddress)}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          {identity.explorerUrl && (
            <a
              href={identity.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on Arcscan
            </a>
          )}
          {identity.metadataUri && (
            <a
              href={identity.metadataUri}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Metadata
            </a>
          )}
        </div>

        {identity.lastError && (
          <p className="text-xs text-red-600 dark:text-red-300">{identity.lastError}</p>
        )}
      </CardContent>
    </Card>
  );
}
