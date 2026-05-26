/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: 'hsl(214, 83%, 28%)',
          foreground: 'hsl(0, 0%, 100%)',
        },
        accent: {
          DEFAULT: 'hsl(20, 82%, 52%)',
        },
      },
      animation: {
        'in': 'in 0.15s ease-out',
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        in: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};