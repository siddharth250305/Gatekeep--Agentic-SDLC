/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Apple HIG Color System (Themeable with CSS variables)
        canvas: 'var(--color-canvas, #f5f5f7)',
        surface: 'var(--color-surface, #ffffff)',
        'surface-glass': 'var(--color-surface-glass, rgba(255, 255, 255, 0.82))',
        sunken: 'var(--color-sunken, #f0f0f2)',
        line: 'var(--color-line, rgba(0, 0, 0, 0.08))',
        'line-strong': 'var(--color-line-strong, rgba(0, 0, 0, 0.16))',
        ink: 'var(--color-ink, #1d1d1f)',
        muted: 'var(--color-muted, #5c5c61)',
        faint: 'var(--color-faint, #67676c)',
        // System Tints (HIG specifications)
        accent: '#0071e3',          // Apple System Blue
        'accent-hover': '#0077ed',
        'accent-bg': 'rgba(0, 113, 227, 0.08)',
        green: '#34c759',           // Apple System Green
        'green-bg': 'rgba(52, 199, 89, 0.12)',
        amber: '#ff9500',           // Apple System Orange/Amber
        'amber-bg': 'rgba(255, 149, 0, 0.12)',
        red: '#ff3b30',             // Apple System Red
        'red-bg': 'rgba(255, 59, 48, 0.12)',
        blue: '#0071e3',
        'blue-bg': 'rgba(0, 113, 227, 0.08)',
      },
      fontFamily: {
        // Apple Human Interface Guidelines: SF Pro hierarchy & SF Mono
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"SF Pro"',
          'Geist',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Geist Mono"',
          'ui-monospace',
          'monospace',
        ],
        code: [
          '"SF Mono"',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Geist Mono"',
          'monospace',
        ],
      },
      borderRadius: {
        // Apple continuous corner curves (squircles)
        DEFAULT: '8px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
        '3xl': '24px',
        pill: '9999px',
      },
      boxShadow: {
        // Apple smooth multi-layer ambient diffuse shadows
        card: '0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        'card-hover': '0 6px 16px rgba(0, 0, 0, 0.06), 0 2px 4px rgba(0, 0, 0, 0.02)',
        pop: '0 16px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.05)',
        btn: '0 1px 2px rgba(0, 0, 0, 0.08), inset 0 1px 0.5px rgba(255, 255, 255, 0.25)',
        segmented: '0 1px 3px rgba(0, 0, 0, 0.08), 0 0.5px 1px rgba(0, 0, 0, 0.04)',
        glass: '0 4px 24px rgba(0, 0, 0, 0.06), inset 0 0 0 1px rgba(255, 255, 255, 0.7)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.99)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        rise: 'rise 350ms cubic-bezier(0.16, 1, 0.3, 1) backwards',
      },
    },
  },
  plugins: [],
}
