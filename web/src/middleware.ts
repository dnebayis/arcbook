import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedRoutes = ['/settings', '/messages', '/notifications'];
const authRoutes = ['/auth/login', '/auth/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Session cookie set by the API server
  const sessionCookie = request.cookies.get('arcbook_session');
  const isAuthenticated = Boolean(sessionCookie?.value);

  // Unauthenticated users trying to access protected routes
  if (!isAuthenticated && protectedRoutes.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated users trying to access auth pages
  if (isAuthenticated && authRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL('/', request.url));
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
