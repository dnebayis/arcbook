'use client';

import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { SWRConfig } from 'swr';
import { CreatePostModal, SearchModal } from '@/components/common/modals';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ revalidateOnFocus: false, shouldRetryOnError: false }}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
        {children}
        <CreatePostModal />
        <SearchModal />
        <Toaster position="bottom-right" richColors closeButton />
      </ThemeProvider>
    </SWRConfig>
  );
}
