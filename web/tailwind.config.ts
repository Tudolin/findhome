import type { Config } from 'tailwindcss';

/**
 * Neumorphic pistachio theme, in two skins.
 *
 * Neumorphism only reads correctly when the element and the page share one
 * background colour — depth comes entirely from a light shadow on one side and a
 * darker one on the other. So there is a single `surface` tone used almost
 * everywhere, three shadow depths, and an inset variant for anything that should
 * look pressed in (inputs, active toggles, wells).
 *
 * Every value here is a CSS custom property rather than a literal, and the two
 * palettes live in globals.css under `:root` and `:root[data-theme='dark']`.
 * That indirection is what makes dark mode possible at all: the style's depth
 * comes from two shadow tones that must both flip with the background, and a
 * Tailwind `dark:` variant cannot restyle a box-shadow that is baked into a
 * utility class. One attribute on <html> now reskins the entire system.
 *
 * Colours are stored as space-separated RGB channels ("238 243 232") so Tailwind
 * can still apply opacity modifiers like `bg-surface/95`.
 *
 * The known weakness of the style is contrast, so text stays on the darker
 * `ink-700/800/900` steps in light mode and the lighter ones in dark mode — the
 * scale is inverted in globals.css rather than at every call site.
 */

const rgb = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The page + every raised element.
        surface: {
          DEFAULT: rgb('--c-surface'),
          raised: rgb('--c-surface-raised'),
          sunken: rgb('--c-surface-sunken'),
          white: rgb('--c-surface-white'),
        },
        // Neutral text/borders — green-tinted greys so they sit in the same
        // family as the pistachio accent instead of looking blue next to it.
        ink: {
          50: rgb('--c-ink-50'),
          100: rgb('--c-ink-100'),
          200: rgb('--c-ink-200'),
          300: rgb('--c-ink-300'),
          400: rgb('--c-ink-400'),
          500: rgb('--c-ink-500'),
          600: rgb('--c-ink-600'),
          700: rgb('--c-ink-700'),
          800: rgb('--c-ink-800'),
          900: rgb('--c-ink-900'),
          950: rgb('--c-ink-950'),
        },
        // Pistachio.
        brand: {
          50: rgb('--c-brand-50'),
          100: rgb('--c-brand-100'),
          200: rgb('--c-brand-200'),
          300: rgb('--c-brand-300'),
          400: rgb('--c-brand-400'),
          500: rgb('--c-brand-500'),
          600: rgb('--c-brand-600'),
          700: rgb('--c-brand-700'),
          800: rgb('--c-brand-800'),
          900: rgb('--c-brand-900'),
          950: rgb('--c-brand-950'),
        },
        /**
         * Semantic state colours.
         *
         * Tailwind's fixed palette cannot serve both skins: `text-rose-700` is
         * right on a light surface and illegible on a dark one, and `rose-400`
         * is the reverse. These flip with the theme, so status text is written
         * once and reads correctly in both.
         */
        danger: rgb('--c-danger'),
        warning: rgb('--c-warning'),
        info: rgb('--c-info'),
        plan: rgb('--c-plan'),
      },
      boxShadow: {
        neu: '6px 6px 12px var(--neu-dark), -6px -6px 12px var(--neu-light)',
        'neu-sm': '3px 3px 7px var(--neu-dark-soft), -3px -3px 7px var(--neu-light)',
        'neu-lg': '12px 12px 24px var(--neu-dark), -12px -12px 24px var(--neu-light)',
        'neu-inset': 'inset 5px 5px 10px var(--neu-dark), inset -5px -5px 10px var(--neu-light)',
        'neu-inset-sm': 'inset 2px 2px 5px var(--neu-dark-soft), inset -2px -2px 5px var(--neu-light)',
        // Accent-tinted extrusion for primary buttons.
        'neu-brand': '5px 5px 12px var(--neu-brand-dark), -5px -5px 12px var(--neu-brand-light)',
        'neu-brand-inset':
          'inset 4px 4px 9px var(--neu-brand-inset-dark), inset -4px -4px 9px var(--neu-brand-inset-light)',
      },
      transitionTimingFunction: {
        neu: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
