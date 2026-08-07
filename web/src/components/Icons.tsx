/**
 * The icon set, as inline SVG.
 *
 * No icon library. Fourteen glyphs do not justify a dependency, a bundle, or a
 * licence to keep track of — and inline SVG inherits `currentColor`, so an icon
 * follows the neumorphic palette through every theme swap without a single extra
 * class.
 *
 * All of them are 24×24 on a 1.75 stroke, which is what keeps a row of them
 * optically even. Emoji were the obvious shortcut and are deliberately not used:
 * they render differently on every platform, cannot take the accent colour, and
 * read as placeholder art in a navigation rail.
 */

export type IconProps = { className?: string };

/** Shared wrapper: one place for the viewBox, stroke and accessibility default. */
function Icon({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: every icon here sits beside its own text label, or
      // inside a button that carries an aria-label. Announcing it twice is worse
      // than not announcing it.
      aria-hidden="true"
      focusable="false"
      className={className ?? 'h-5 w-5'}
    >
      {children}
    </svg>
  );
}

/** Discovery — a compass, for looking around. */
export const IconCompass = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </Icon>
);

/** Your homes — a bookmark, for what you kept. */
export const IconBookmark = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 4h12v16l-6-4-6 4z" />
  </Icon>
);

export const IconMap = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5-6 2v13l6-2 6 2 6-2V5l-6 2z" />
    <path d="M9 5v13M15 7v13" />
  </Icon>
);

export const IconCalendar = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);

/** Co-op — two people. */
export const IconUsers = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16.5 5.5a3.25 3.25 0 0 1 0 5.9M18 20a6 6 0 0 0-2.2-4.6" />
  </Icon>
);

/** Preferences — sliders, not a cog: this screen is filters, not settings. */
export const IconSliders = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);

export const IconShield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6z" />
    <path d="m9.5 12 1.8 1.8L15 10" />
  </Icon>
);

export const IconMenu = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconLogout = (props: IconProps) => (
  <Icon {...props}>
    <path d="M15 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8" />
    <path d="m17 9 3 3-3 3M20 12h-9" />
  </Icon>
);

export const IconPlus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** The "more" entry on the mobile tab bar. */
export const IconDots = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
);

/** Collapse/expand the rail. Points the way it will move. */
export const IconPanel = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <path d="M10 4v16" />
  </Icon>
);
