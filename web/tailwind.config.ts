import type { Config } from 'tailwindcss';

/**
 * Neumorphic pistachio theme.
 *
 * Neumorphism only reads correctly when the element and the page share one
 * background colour — depth comes entirely from a light shadow up-left and a
 * darker one down-right. So there is a single `surface` tone used almost
 * everywhere, three shadow depths, and an inset variant for anything that
 * should look pressed in (inputs, active toggles, wells).
 *
 * The known weakness of the style is contrast, so text stays on the dark
 * `ink-700/800/900` steps and never sits on a tinted chip without a matching
 * dark foreground.
 */

// Kept in one place: every neu shadow must use exactly these two tones or the
// light source stops looking consistent across the page.
const LIGHT = '#ffffff';
const DARK = '#c7d3bc';
const DARK_SOFT = '#d3ddc9';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The page + every raised element.
        surface: {
          DEFAULT: '#eef3e8',
          raised: '#f3f7ee',
          sunken: '#e6ede0',
          white: '#ffffff',
        },
        // Neutral text/borders — green-tinted greys so they sit in the same
        // family as the pistachio accent instead of looking blue next to it.
        ink: {
          50: '#f7faf4',
          100: '#eef3e8',
          200: '#e0e8d8',
          300: '#c7d3bc',
          400: '#9caf90',
          500: '#788b6d',
          600: '#5d6e54',
          700: '#495742',
          800: '#374232',
          900: '#283025',
          950: '#171d15',
        },
        // Pistachio.
        brand: {
          50: '#f3f9ec',
          100: '#e5f2d7',
          200: '#cde6b3',
          300: '#aed485',
          400: '#93c572',
          500: '#7cb45c',
          600: '#619946',
          700: '#4b7838',
          800: '#3d5f30',
          900: '#334e2a',
          950: '#192b14',
        },
      },
      boxShadow: {
        neu: `6px 6px 12px ${DARK}, -6px -6px 12px ${LIGHT}`,
        'neu-sm': `3px 3px 7px ${DARK_SOFT}, -3px -3px 7px ${LIGHT}`,
        'neu-lg': `12px 12px 24px ${DARK}, -12px -12px 24px ${LIGHT}`,
        'neu-inset': `inset 5px 5px 10px ${DARK}, inset -5px -5px 10px ${LIGHT}`,
        'neu-inset-sm': `inset 2px 2px 5px ${DARK_SOFT}, inset -2px -2px 5px ${LIGHT}`,
        // Accent-tinted extrusion for primary buttons.
        'neu-brand': '5px 5px 12px #8aa878, -5px -5px 12px #a9dd8c',
        'neu-brand-inset': 'inset 4px 4px 9px #567f3d, inset -4px -4px 9px #8ed46a',
      },
      transitionTimingFunction: {
        neu: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
