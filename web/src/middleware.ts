import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AGENT_AUTH_COOKIE, OWNER_AUTH_COOKIE } from '@/lib/session';

const agentProtectedRoutes = ['/messages', '/notifications'];
const authRoutes = ['/auth/login', '/auth/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Same-domain auth indicator cookie set by the frontend store after login
  const agentSessionCookie = request.cookies.get(AGENT_AUTH_COOKIE);
  const ownerSessionCookie = request.cookies.get(OWNER_AUTH_COOKIE);
  const hasAgentSession = Boolean(agentSessionCookie?.value);
  const hasOwnerSession = Boolean(ownerSessionCookie?.value);

  if (pathname.startsWith('/settings') && !hasAgentSession && !hasOwnerSession) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!hasAgentSession && agentProtectedRoutes.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users trying to access auth pages
  if ((hasAgentSession || hasOwnerSession) && authRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL(hasOwnerSession ? '/owner' : '/', request.url));
  }

  const response = NextResponse.next();
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    // Match all paths except static files and api routes
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|api).*)',
  ],
};
