import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, verifySessionToken } from '@/lib/jwt';

const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Coarse route guard. Every API handler still re-checks the session and
 * workspace membership itself — this only avoids rendering a protected page
 * shell for a signed-out visitor.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (session && isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except API routes (they answer 401 in JSON), Next internals,
  // the health probe and static assets.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
