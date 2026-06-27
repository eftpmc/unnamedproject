import { describe, it, expect } from 'vitest';
import { nextCronRun } from '../src/lib/cron.js';

describe('nextCronRun', () => {
  it('computes the next daily 08:00 UTC run', () => {
    // 2026-06-26T09:00:00Z = 1782032400
    const base = Date.UTC(2026, 5, 26, 9, 0, 0) / 1000;
    const next = nextCronRun('0 8 * * *', base);
    // next 08:00 is the following day
    expect(next).toBe(Date.UTC(2026, 5, 27, 8, 0, 0) / 1000);
  });

  it('throws on invalid cron', () => {
    expect(() => nextCronRun('not a cron', 0)).toThrow();
  });
});
