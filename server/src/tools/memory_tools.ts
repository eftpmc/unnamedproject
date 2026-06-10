import { rememberFact, recallFact, recallAll } from '../services/memory.js';

export function remember(userId: string, key: string, value: string): string {
  rememberFact(userId, key, value);
  return `Remembered: ${key} = ${value}`;
}

export function recall(userId: string, key: string | null): string {
  if (key) {
    const value = recallFact(userId, key);
    return value ? `${key}: ${value}` : `No memory for key: ${key}`;
  }
  const all = recallAll(userId);
  const entries = Object.entries(all);
  if (entries.length === 0) return 'No memories stored.';
  return entries.map(([k, v]) => `${k}: ${v}`).join('\n');
}
