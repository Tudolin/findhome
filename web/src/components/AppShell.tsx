'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import AppearanceMenu from './AppearanceMenu';
import { useT } from './LocaleProvider';
import type { Theme } from '@/lib/theme';
import {
  IconBookmark,
  IconCalendar,
  IconClose,
  IconCompass,
  IconDots,
  IconLogout,
  IconMap,
  IconMenu,
  IconPanel,
  IconPlus,
  IconShield,
  IconSliders,
  IconUsers,
  type IconProps,
} from './Icons';

export type WorkspaceOption = {
  id: string;
  kind: 'SOLO' | 'PARTY';
  name: string;
  memberCount: number;
  inviteCode: string | null;
};

/**
 * The application shell: a rail on the desktop, a drawer and a tab bar on a
 * phone.
 *
 * ## Why it replaced the top bar
 *
 * The old horizontal bar held a logo, a workspace switcher, seven destinations, a
 * name, an appearance menu and a sign-out button in one row. On a laptop the
 * destinations were already crowding the switcher; on a phone they became a
 * horizontally scrolling strip, which is the pattern where people simply never
 * discover the items past the fold. Seven destinations is where a horizontal bar
 * stops working.
 *
 * A vertical rail scales with the list instead of fighting it, gives every entry
 * a real label and an icon, and leaves the top of the content free.
 *
 * ## Why two mobile surfaces
 *
 * The four destinations people hit constantly live in a bottom tab bar, where a
 * thumb reaches them. Everything else — the other three screens, the workspace
 * switcher, appearance, sign out — lives behind "Mais", which opens the same
 * drawer the hamburger does. That split is what most apps do, and it is the
 * reason: a phone can show four things well and seven things badly.
 *
 * The shell wraps `children` rather than sitting beside them because the content's
 * left padding has to follow the rail's collapsed state, which is client state.
 */

type NavItem = { href: string; label: string; icon: (props: IconProps) => React.ReactElement };

/** Where to break to the rail. Matches Tailwind's `lg`. */
const DESKTOP = '(min-width: 1024px)';
const COLLAPSE_KEY = 'fh_rail_collapsed';

export default function AppShell({
  user,
  workspaces,
  activeId,
  theme,
  children,
}: {
  user: { name: string; email: string };
  workspaces: WorkspaceOption[];
  activeId: string;
  theme: Theme;
  children: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();

  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /** Suppresses the width transition until localStorage has been read. */
  const [ready, setReady] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [pending, startTransition] = useTransition();

  const drawerRef = useRef<HTMLDivElement>(null);

  const nav: NavItem[] = [
    { href: '/dashboard', label: t.nav.discovery, icon: IconCompass },
    { href: '/my-homes', label: t.nav.myHomes, icon: IconBookmark },
    { href: '/map', label: t.nav.map, icon: IconMap },
    { href: '/visits', label: t.nav.visits, icon: IconCalendar },
    { href: '/co-op', label: t.nav.coop, icon: IconUsers },
    { href: '/preferences', label: t.nav.preferences, icon: IconSliders },
    { href: '/security', label: t.nav.security, icon: IconShield },
  ];

  /** The four a thumb should reach without opening anything. */
  const primary = nav.slice(0, 4);

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  /**
   * Rail collapse, remembered per device.
   *
   * Read in an effect rather than during render, because localStorage does not
   * exist on the server and reading it inline would make the first client render
   * disagree with the HTML.
   *
   * The cost is honest and small: someone who collapsed the rail sees it expanded
   * for one frame after load. A cookie would remove even that — the server would
   * know — at the price of a round trip on every toggle. Not worth it for a
   * preference this size; revisit if it ever becomes noticeable.
   */
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    setReady(true);
  }, []);

  function toggleCollapse() {
    setCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  // --- Drawer --------------------------------------------------------------
  // Closed on navigation. Without this, tapping a destination leaves the drawer
  // covering the page you just asked for.
  useEffect(() => {
    setDrawer(false);
    setSwitcher(false);
    setUserMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawer) return;

    const panel = drawerRef.current;

    /**
     * Escape closes; Tab is trapped inside the panel.
     *
     * The trap is not decoration. The drawer declares `aria-modal="true"`, which
     * tells a screen reader that nothing outside it exists — and if Tab then walks
     * out into the page behind the overlay, that promise is a lie and the user is
     * lost with no way back. Either both, or neither.
     */
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawer(false);
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);

    // Scroll lock. A drawer over a page that still scrolls underneath is the
    // single most common way this pattern feels broken on a phone.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus moves into the panel so the keyboard and screen reader follow it.
    panel?.focus();

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [drawer]);

  // A resize past the breakpoint leaves a drawer open over a rail that is already
  // showing the same links.
  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawer(false);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  async function switchWorkspace(workspaceId: string) {
    setSwitcher(false);
    if (workspaceId === activeId) return;
    await fetch('/api/workspace', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    // The active workspace changes every server query, so refresh the tree.
    startTransition(() => router.refresh());
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  /** Two initials, for the avatar. */
  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  /* ---------------------------------------------------------------------- */
  /* Pieces, shared by the rail and the drawer.                              */
  /* ---------------------------------------------------------------------- */

  const brand = (compact: boolean) => (
    <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-400 text-sm font-black text-brand-950 shadow-neu-brand">
        FH
      </span>
      {!compact && <span className="truncate text-base font-bold tracking-tight text-ink-800">FindHome</span>}
    </Link>
  );

  const navList = (compact: boolean) => (
    <nav className="space-y-1.5" aria-label={t.nav.menu}>
      {nav.map((item) => {
        const on = isActive(item.href);
        const Glyph = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            title={compact ? item.label : undefined}
            className={clsx(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all duration-150 ease-neu',
              compact && 'justify-center px-0',
              on
                ? 'bg-surface text-brand-700 shadow-neu-inset-sm'
                : 'bg-surface text-ink-600 shadow-neu-sm hover:text-ink-900',
            )}
          >
            <Glyph className="h-5 w-5 shrink-0" />
            {!compact && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  const workspaceSwitcher = (compact: boolean) => (
    <div className="relative">
      <button
        type="button"
        onClick={() => setSwitcher((v) => !v)}
        aria-expanded={switcher}
        title={compact ? active?.name : undefined}
        className={clsx(
          'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ease-neu',
          compact && 'justify-center px-0',
          switcher ? 'shadow-neu-inset-sm' : 'shadow-neu-sm',
          pending && 'opacity-60',
        )}
      >
        <span
          className={clsx(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            active?.kind === 'PARTY' ? 'bg-brand-500' : 'bg-ink-400',
          )}
        />
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-800">
                {active?.name ?? t.nav.personalSearch}
              </span>
              <span className="block truncate text-[11px] text-ink-500">
                {active?.kind === 'SOLO' ? t.nav.soloMode : t.nav.party(active?.memberCount ?? 1)}
              </span>
            </span>
            <span aria-hidden className="text-ink-400">
              ▾
            </span>
          </>
        )}
      </button>

      {switcher && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setSwitcher(false)} />
          <div className="absolute left-0 right-0 z-20 mt-2 rounded-2xl bg-surface p-2 shadow-neu-lg">
            <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-ink-500">
              {t.nav.workspaces}
            </p>
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {workspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchWorkspace(w.id)}
                  className={clsx(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-all duration-150',
                    w.id === activeId
                      ? 'bg-surface text-brand-700 shadow-neu-inset-sm'
                      : 'bg-surface text-ink-700 shadow-neu-sm hover:text-ink-900',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{w.name}</span>
                    <span className="block text-xs font-normal text-ink-500">
                      {w.kind === 'SOLO' ? t.nav.soloMode : t.nav.party(w.memberCount)}
                    </span>
                  </span>
                  {w.id === activeId && <span className="text-brand-600">✓</span>}
                </button>
              ))}
            </div>
            <Link
              href="/co-op#party"
              className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-700 shadow-neu-sm hover:text-brand-800"
            >
              <IconPlus className="h-4 w-4" />
              {t.nav.createOrJoin}
            </Link>
          </div>
        </>
      )}
    </div>
  );

  const userBlock = (compact: boolean) => (
    <div className={clsx('relative flex items-center gap-2', compact && 'flex-col')}>
      <button
        type="button"
        onClick={() => setUserMenu((v) => !v)}
        aria-expanded={userMenu}
        title={compact ? user.name : undefined}
        className={clsx(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-150 ease-neu',
          userMenu ? 'shadow-neu-inset-sm' : 'shadow-neu-sm',
          compact && 'flex-none justify-center px-0 py-2',
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-black text-ink-600 shadow-neu-inset-sm">
          {initials || '·'}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-800">{user.name}</span>
            <span className="block truncate text-[11px] text-ink-500">{user.email}</span>
          </span>
        )}
      </button>

      {/* Appearance keeps its own component — it owns the theme and locale
          round-trips, and nesting it inside the user popover would mean two
          dropdowns fighting over the same outside-click handler.
          `align="left"` when collapsed, or the panel opens off the left edge of a
          76px rail. */}
      <AppearanceMenu theme={theme} placement="up" align={compact ? 'left' : 'right'} />

      {userMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setUserMenu(false)} />
          {/* Opens upward: this sits at the bottom of the viewport, and a
              downward menu would render off-screen. */}
          <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-2xl bg-surface p-2 shadow-neu-lg">
            <p className="truncate px-3 py-2 text-[11px] text-ink-500">{user.email}</p>
            <Link
              href="/security"
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink-700 shadow-neu-sm hover:text-ink-900"
            >
              <IconShield className="h-4 w-4" />
              {t.nav.security}
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="mt-1.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-danger shadow-neu-sm hover:opacity-80"
            >
              <IconLogout className="h-4 w-4" />
              {t.nav.signOut}
            </button>
          </div>
        </>
      )}
    </div>
  );

  /* ---------------------------------------------------------------------- */

  return (
    <div className="min-h-screen">
      {/* ---------------- Desktop rail ---------------- */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-30 hidden flex-col gap-5 border-r border-ink-200/20 bg-surface p-4 lg:flex',
          ready && 'transition-[width] duration-200 ease-neu',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <div className={clsx('flex items-center', collapsed ? 'justify-center' : 'justify-between gap-2')}>
          {brand(collapsed)}
          {!collapsed && (
            <button
              type="button"
              onClick={toggleCollapse}
              aria-label={t.nav.collapse}
              title={t.nav.collapse}
              className="rounded-lg p-1.5 text-ink-400 shadow-neu-sm transition-all hover:text-ink-700"
            >
              <IconPanel className="h-4 w-4" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label={t.nav.expand}
            title={t.nav.expand}
            className="mx-auto rounded-lg p-1.5 text-ink-400 shadow-neu-sm transition-all hover:text-ink-700"
          >
            <IconPanel className="h-4 w-4 rotate-180" />
          </button>
        )}

        {workspaceSwitcher(collapsed)}

        <div className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">{navList(collapsed)}</div>

        {userBlock(collapsed)}
      </aside>

      {/* ---------------- Mobile top bar ---------------- */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label={t.nav.openMenu}
          aria-expanded={drawer}
          className="rounded-xl p-2 text-ink-700 shadow-neu-sm"
        >
          <IconMenu />
        </button>

        {brand(false)}

        <span className="ml-auto flex min-w-0 items-center gap-1.5 rounded-full px-3 py-1.5 shadow-neu-inset-sm">
          <span
            className={clsx(
              'h-2 w-2 shrink-0 rounded-full',
              active?.kind === 'PARTY' ? 'bg-brand-500' : 'bg-ink-400',
            )}
          />
          <span className="truncate text-[11px] font-bold text-ink-600">{active?.name}</span>
        </span>
      </header>

      {/* ---------------- Mobile drawer ---------------- */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* `bg-black`, not `bg-ink-950`. The ink scale is INVERTED in dark mode
              (see globals.css), so ink-950 is near-white there and the scrim would
              wash the screen out instead of dimming it. A modal scrim is one of
              the few things that should not follow the palette. */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.nav.menu}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col gap-5 bg-surface p-4 shadow-neu-lg outline-none"
          >
            <div className="flex items-center justify-between gap-2">
              {brand(false)}
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label={t.common.close}
                className="rounded-xl p-2 text-ink-600 shadow-neu-sm"
              >
                <IconClose />
              </button>
            </div>

            {workspaceSwitcher(false)}

            <div className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">{navList(false)}</div>

            {userBlock(false)}
          </div>
        </div>
      )}

      {/* ---------------- Content ---------------- */}
      <div className={clsx(ready && 'transition-[padding] duration-200 ease-neu', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        {/* `pb-24` clears the tab bar on a phone; the rail needs no such room. */}
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 lg:pb-10 lg:pt-8">{children}</main>
      </div>

      {/* ---------------- Mobile tab bar ---------------- */}
      <nav
        aria-label={t.nav.menu}
        // `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the home
        // indicator on an iPhone, where the last 34px are not tappable.
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t border-ink-200/20 bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur lg:hidden"
      >
        {primary.map((item) => {
          const on = isActive(item.href);
          const Glyph = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={on ? 'page' : undefined}
              className={clsx(
                'flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-bold transition-colors',
                on ? 'text-brand-700' : 'text-ink-500',
              )}
            >
              <Glyph className={clsx('h-5 w-5', on && 'scale-110 transition-transform')} />
              <span className="w-full truncate text-center leading-tight">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="flex flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-bold text-ink-500"
        >
          <IconDots className="h-5 w-5" />
          <span className="leading-tight">{t.nav.more}</span>
        </button>
      </nav>
    </div>
  );
}
