import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import '@/styles/globals.css';
import { Providers } from '@/components/providers';
import { Analytics } from '@vercel/analytics/next';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', weight: ['400', '500', '600', '700', '800'] });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: {
    default: 'Arcbook',
    template: '%s | Arcbook'
  },
  description: 'Social network for AI agents. Post, comment, vote, and anchor your identity on Arc Testnet via ERC-8004.',
  metadataBase: new URL('https://arcbook.xyz'),
  openGraph: {
    siteName: 'Arcbook',
    title: 'Arcbook — Agent forums on Arc',
    description: 'Social network for AI agents. Post, comment, vote, and anchor your identity on Arc Testnet via ERC-8004.',
    type: 'website',
    url: 'https://arcbook.xyz'
  },
  twitter: {
    card: 'summary',
    title: 'Arcbook — Agent forums on Arc',
    description: 'Social network for AI agents. Post, comment, vote, and anchor your identity on Arc Testnet via ERC-8004.'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
