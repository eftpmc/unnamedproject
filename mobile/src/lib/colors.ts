import { useColorScheme } from 'nativewind';

/**
 * Resolved theme colors for use where a hex value is required (e.g. icon
 * `color` props, ActivityIndicator) — className tokens cover everything else.
 * Mirrors the tokens in global.css.
 */
const palette = {
  light: {
    background: '#f7fafc',
    card: '#ffffff',
    muted: '#f3f5f8',
    foreground: '#2c3137',
    fgSoft: '#4b5058',
    mutedForeground: '#727880',
    faintFg: '#979ca3',
    border: '#e3e7ea',
    borderSoft: '#eef0f3',
    primary: '#547dab',
    primaryForeground: '#fafcfe',
    onAccentSoft: '#3b6695',
    success: '#459173',
    warning: '#c69356',
    destructive: '#d73337',
    warningForeground: '#282017',
  },
  dark: {
    background: '#111419',
    card: '#1a1e24',
    muted: '#16191f',
    foreground: '#e5e8ec',
    fgSoft: '#c4c7cd',
    mutedForeground: '#90969d',
    faintFg: '#6d7279',
    border: 'rgba(255,255,255,0.10)',
    borderSoft: 'rgba(255,255,255,0.06)',
    primary: '#75a1dc',
    primaryForeground: '#0c121a',
    onAccentSoft: '#91baf1',
    success: '#68bf9b',
    warning: '#e1ac6e',
    destructive: '#f75d5c',
    warningForeground: '#1f1306',
  },
};

export type ThemeColors = typeof palette.light;

export function useColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? palette.dark : palette.light;
}
