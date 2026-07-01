import { runDueTriggers } from './triggerRunner.js';
import { logger } from '../lib/logger.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    runDueTriggers().catch(err => logger.error('[scheduler] error', { err: err instanceof Error ? err.message : String(err) }));
  }, POLL_INTERVAL_MS);
}
