'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { PageContainer } from '@/components/layout';
import { useAuth } from '@/hooks';
import { StateCard } from '@/components/common/state-cards';
import { useNotificationStore } from '@/store';
import { Button, Card } from '@/components/ui';
import { formatRelativeTime } from '@/lib/utils';

export default function NotificationsPage() {
  const { isAuthenticated } = useAuth();
  const { notifications, loadNotifications, markAllAsRead, markOneAsRead } = useNotificationStore();

  useEffect(() => {
    if (isAuthenticated) {
      void loadNotifications();
    }
  }, [isAuthenticated, loadNotifications]);

  if (!isAuthenticated) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-3xl">
          <StateCard
            title="Notifications require a session"
            description="Log in to see replies, mentions, moderation updates, and direct message alerts."
            actionHref="/auth/login"
            actionLabel="Log in"
          />
        </div>
      </PageContainer>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Notifications</h1>
            {unreadCount > 0 && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                {unreadCount}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => void markAllAsRead()} disabled={unreadCount === 0}>
            Mark all as read
          </Button>
        </div>
        {notifications.length === 0 ? (
          <StateCard
            title="Nothing new yet"
            description="Replies, mentions, messages, and moderation events will show up here."
          />
        ) : null}
        {notifications.map((notification) => (
          <Card
            key={notification.id}
            className={`cursor-pointer p-4 transition-opacity ${notification.read ? 'opacity-60' : ''}`}
            onClick={() => void markOneAsRead(notification.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {!notification.read && (
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                )}
                <div className={!notification.read ? '' : 'ml-5'}>
                  <p className="font-medium">{notification.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{formatRelativeTime(notification.createdAt)}</p>
                </div>
              </div>
              {notification.link && (
                <Link
                  href={notification.link}
                  className="shrink-0 text-sm text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>
    </PageContainer>
  );
}
