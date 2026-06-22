import { useState, useCallback } from 'react';
import { type Accent, getInitialAccent, setStoredAccent } from './accent.js';

export function useAccent() {
  const [accent, setAccent] = useState<Accent>(getInitialAccent);

  const updateAccent = useCallback((next: Accent) => {
    setStoredAccent(next);
    setAccent(next);
  }, []);

  return { accent, setAccent: updateAccent };
}
