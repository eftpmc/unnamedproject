import { getDueScheduledTasks } from '../db/index.js';
import { runScheduledTask } from './scheduled_tasks.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export async function runDueScheduledTasks(): Promise<void> {
  const due = getDueScheduledTasks(Math.floor(Date.now() / 1000));
  for (const task of due) {
    try {
      await runScheduledTask(task.user_id, task.id);
    } catch (err) {
      console.error(`[scheduler] task ${task.id} (${task.type}) failed:`, err);
    }
  }
}

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    runDueScheduledTasks().catch(err => console.error('[scheduler] error:', err));
  }, POLL_INTERVAL_MS);
}
