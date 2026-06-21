import { describe, it, expect, vi, afterEach } from 'vitest';
import { logger } from '../../src/lib/logger.js';

const ORIG = process.env.LOG_LEVEL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = ORIG;
  vi.restoreAllMocks();
});

describe('logger', () => {
  it('emits at or above the configured level and suppresses below it', () => {
    process.env.LOG_LEVEL = 'warn';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('shown');
    logger.info('hidden');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('includes structured metadata in the output', () => {
    process.env.LOG_LEVEL = 'info';
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('request', { status: 200, ms: 5 });
    const line = (log.mock.calls[0]?.[0] as string) ?? '';
    expect(line).toContain('request');
    expect(line).toContain('200');
  });
});
