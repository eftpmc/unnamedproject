export interface Accent {
  h: number;
  c: number;
}

export interface AccentPreset extends Accent {
  name: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: 'Blue', h: 252, c: 0.085 },
  { name: 'Violet', h: 290, c: 0.09 },
  { name: 'Teal', h: 190, c: 0.08 },
  { name: 'Green', h: 155, c: 0.08 },
  { name: 'Amber', h: 70, c: 0.09 },
  { name: 'Rose', h: 15, c: 0.1 },
  { name: 'Slate', h: 252, c: 0.02 },
];

export const DEFAULT_ACCENT: Accent = ACCENT_PRESETS[0];

const STORAGE_KEY = 'accent';

function isAccent(value: unknown): value is Accent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Accent).h === 'number' &&
    typeof (value as Accent).c === 'number'
  );
}

export function getStoredAccent(): Accent | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return isAccent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getInitialAccent(): Accent {
  return getStoredAccent() ?? DEFAULT_ACCENT;
}

export function applyAccent(accent: Accent) {
  document.documentElement.style.setProperty('--accent-h', String(accent.h));
  document.documentElement.style.setProperty('--accent-c', String(accent.c));
}

export function setStoredAccent(accent: Accent) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accent));
  applyAccent(accent);
}
