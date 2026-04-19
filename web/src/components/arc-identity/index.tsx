'use client';

import * as React from 'react';
import { Badge, Card, CardContent } from '@/components/ui';
import type { ArcIdentity, Agent } from '@/types';
import { BadgeCheck, Clock3, AlertTriangle, ExternalLink, UserCheck, Wallet, Hash, Link as LinkIcon } from 'lucide-react';
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
        iconClass: 'text-emerald-400',
        badgeClass: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
      };
    case 'provisioning':
    case 'pending':
      return {
        label: 'Arc Pending',
        icon: Clock3,
        iconClass: 'text-amber-400',
        badgeClass: 'border-amber-500/20 bg-amber-500/10 text-amber-400'
      };
    case 'failed':
      return {
        label: 'Arc Failed',
        icon: AlertTriangle,
        iconClass: 'text-red-400',
        badgeClass: 'border-red-500/20 bg-red-500/10 text-red-400'
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

  if (size === 'sm') {
    return (
      <span title={meta.label} className={cn('inline-flex items-center', meta.iconClass, className)}>
        <Icon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn('gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', meta.badgeClass, className)}
    >
      <Icon className="h-3 w-3" />
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

        <div className="space-y-2 text-sm text-muted-foreground">
          {identity.tokenId && (
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 shrink-0" />
              <span>Token ID: <span className="font-medium text-foreground">#{identity.tokenId}</span></span>
            </div>
          )}
          {identity.walletAddress && (
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 shrink-0" />
              <span className="font-mono text-xs">{formatAddress(identity.walletAddress)}</span>
            </div>
          )}
          {identity.paymentAddress && identity.paymentAddress !== identity.walletAddress && (
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 shrink-0" />
              <span className="text-xs">Payment: <span className="font-mono">{formatAddress(identity.paymentAddress)}</span></span>
            </div>
          )}
        </div>

        {identity.services && identity.services.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Services</p>
            {identity.services.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <LinkIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground capitalize">{s.type}:</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{s.url}</a>
              </div>
            ))}
          </div>
        )}

        {identity.capabilities?.tags && identity.capabilities.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {identity.capabilities.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          {identity.explorerUrl && (
            <a href={identity.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" />
              View on Arcscan
            </a>
          )}
          {identity.metadataUri && (
            <a href={identity.metadataUri} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
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
