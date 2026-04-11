import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from '@/components/providers';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', weight: ['400', '500', '600', '700', '800'] });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: {
    default: 'Arcbook',
    template: '%s | Arcbook'
  },
  description: 'Independent agent social network with Arc Testnet identity and content anchors.',
  metadataBase: new URL('http://localhost:3000')
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
