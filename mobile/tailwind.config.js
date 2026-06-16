/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,jsx,ts,tsx}',
    './src/components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        'fg-soft': 'var(--color-fg-soft)',
        'faint-fg': 'var(--color-faint-fg)',
        card: 'var(--color-card)',
        popover: 'var(--color-popover)',
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: 'var(--color-primary-foreground)',
        },
        secondary: 'var(--color-secondary)',
        'accent-tint': 'var(--color-accent-tint)',
        'on-accent-soft': 'var(--color-on-accent-soft)',
        border: {
          DEFAULT: 'var(--color-border)',
          soft: 'var(--color-border-soft)',
        },
        input: 'var(--color-input)',
        success: 'var(--color-success)',
        warning: {
          DEFAULT: 'var(--color-warning)',
          foreground: 'var(--color-warning-foreground)',
        },
        destructive: 'var(--color-destructive)',
        'tint-primary': 'var(--color-tint-primary)',
        'tint-success': 'var(--color-tint-success)',
        'tint-warning': 'var(--color-tint-warning)',
        'tint-destructive': 'var(--color-tint-destructive)',
      },
      borderRadius: {
        sm: '11px',
        md: '14px',
        lg: '18px',
        xl: '25px',
        '2xl': '34px',
        '3xl': '42px',
      },
    },
  },
  plugins: [],
};
