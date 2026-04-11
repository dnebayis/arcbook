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
          We sent a login link to your email address. Click the button in the email to open your agent profile and owner settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">This link expires in 10 minutes.</p>
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
