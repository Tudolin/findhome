import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, verifySessionToken } from '@/lib/jwt';

/**
 * Reachable without an account.
 *
 *   /           the public feed — 20 listings, simple filters, a sign-up gate
 *   /imovel/…   one of those listings, read-only
 *   /login,
 *   /register   the way in
 *
 * `/` and `/imovel` are NOT in `AUTH_PATHS` below because a signed-in visitor
 * should be bounced off them to the real app, and those two pages do that
 * themselves — they need the database to decide, which the Edge runtime cannot
 * reach. See the note on `getSession` in lib/auth.ts.
 */
const PUBLIC_PREFIXES = ['/login', '/register', '/imovel'];

/** Pages that exist only for signed-out visitors. */
const AUTH_PATHS = ['/login', '/register'];

/**
 * Coarse route guard. Every API handler still re-checks the session and
 * workspace membership itself — this only avoids rendering a protected page
 * shell for a signed-out visitor.
 *
 * The check here is signature-only, because middleware runs on the Edge runtime
 * and cannot reach Prisma. A token whose session has since been revoked passes
 * *this* gate and is then rejected by `getSession()` in the page or API layer,
 * which is the authority. That split predates the session table and is documented
 * on `verifySessionToken`.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  const isRoot = pathname === '/';
  const isPublic = isRoot || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Only /login and /register. The public feed handles the signed-in case itself
  // so that a shared listing link still resolves to the right page.
  if (session && AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except API routes (they answer 401 in JSON), Next internals,
  // the health probe, static assets and the photo mirror.
  //
  // `media` is excluded on purpose. Those URLs are a SHA-256 of the portal's own
  // URL — unguessable, and the content behind them is already public on the
  // portal. Guarding them would gain nothing and break the one thing the mirror
  // exists for: an `<img src>` that keeps working. Redirecting an image request to
  // /login renders a broken image, not a login screen. See app/media/[...path].
  matcher: ['/((?!api|media|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
