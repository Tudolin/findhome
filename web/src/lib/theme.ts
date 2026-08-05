/** Light / dark skin selection. The palettes themselves live in globals.css. */

export const THEME_COOKIE = 'fh_theme';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

/**
 * Runs before first paint, inlined into <head> by ThemeScript.
 *
 * It has to be a blocking inline script rather than a React effect: an effect
 * runs after hydration, which means one frame of the wrong palette — the
 * notorious white flash on a dark-mode page load. Reading the cookie here also
 * keeps the client in step with what the server rendered.
 *
 * "system" cannot be resolved on the server (there is no request header for
 * prefers-color-scheme), so that case is resolved here and only here.
 */
export const THEME_BOOTSTRAP = `
(function () {
  try {
    var m = document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
    var t = m ? decodeURIComponent(m[1]) : '${DEFAULT_THEME}';
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();
