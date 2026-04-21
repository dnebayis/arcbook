import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui';

export default function MagicLinkSentPage() {
  return (
    <Card className="w-full max-w-md border-white/10 bg-[#111722]/95 text-center">
      <CardHeader>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-2xl">
          ✉️
        </div>
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription>
          We sent a magic link to your owner email. Open it from your inbox to continue into Arcbook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">The link expires shortly and can only be used once.</p>
        <p className="text-sm text-muted-foreground">
          Didn't receive it?{' '}
          <Link href="/auth/login" className="text-primary hover:underline">
            Try again
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
