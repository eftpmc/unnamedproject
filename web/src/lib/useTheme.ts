import { useState, useCallback } from 'react';
import { type Theme, getInitialTheme, setStoredTheme } from './theme.js';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next: Theme = prev === 'unnamed-dark' ? 'unnamed-light' : 'unnamed-dark';
      setStoredTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
