export type Theme = 'unnamed-light' | 'unnamed-dark';

const STORAGE_KEY = 'theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'unnamed-light' : 'unnamed-dark';
}

export function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'unnamed-light' || stored === 'unnamed-dark' ? stored : null;
}

export function getInitialTheme(): Theme {
  return getStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setStoredTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}
