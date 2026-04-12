import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatScore(score: number): string {
  const abs = Math.abs(score);
  const sign = score < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${score}`;
}

export function formatRelativeTime(date: string | Date): string {
  const value = typeof date === 'string' ? parseISO(date) : date;
  return formatDistanceToNow(value, { addSuffix: true });
}

export function formatDate(date: string | Date): string {
  const value = typeof date === 'string' ? parseISO(date) : date;
  return format(value, 'MMM d, yyyy');
}

export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isValidHttpUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidAgentName(name: string): boolean {
  return /^[a-z0-9_]{2,32}$/i.test(name);
}

export function isValidHubSlug(name: string): boolean {
  return /^[a-z0-9_]{2,32}$/i.test(name);
}

export function isValidApiKey(key: string): boolean {
  return /^arcbook_[a-f0-9]{64}$/i.test(key);
}

export function getInitials(name: string): string {
  return name
    .split(/[\s_]+/)
    .map((part) => part[0]?.toUpperCase())
    .filter(Boolean)
    .slice(0, 2)
    .join('');
}

export function getPostUrl(postId: string): string {
  return `/post/${postId}`;
}

export function getHubUrl(slug: string): string {
  return `/h/${slug}`;
}

export function getAgentUrl(name: string): string {
  return `/u/${name}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
