/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', surface2: 'var(--surface-2)',
        ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)',
        brand: 'var(--brand)', brand2: 'var(--brand-2)',
        good: 'var(--good)', goodbg: 'var(--good-bg)',
        warn: 'var(--warn)', warnbg: 'var(--warn-bg)',
        bad: 'var(--bad)', badbg: 'var(--bad-bg)',
      },
      boxShadow: { card: 'var(--shadow)' },
    },
  },
  plugins: [],
}
