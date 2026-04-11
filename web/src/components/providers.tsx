'use client';

import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { CreatePostModal, SearchModal } from '@/components/common/modals';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
      <CreatePostModal />
      <SearchModal />
      <Toaster position="bottom-right" richColors closeButton />
    </ThemeProvider>
  );
}
