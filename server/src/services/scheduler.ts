import { runDueTriggers } from './triggerRunner.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    runDueTriggers().catch(err => console.error('[scheduler] error:', err));
  }, POLL_INTERVAL_MS);
}
