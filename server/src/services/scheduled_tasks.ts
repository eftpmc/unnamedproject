import { getDb, getScheduledTaskForUser, markScheduledTaskRun } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { runAgentTurn } from './agent.js';

const REORGANIZE_MEMORY_PROMPT = `Review your stored memory using \`recall\`. Look for: duplicate or
overlapping entries to merge, outdated/stale facts to \`forget\`, vague
entries that should be split into more specific ones, and entries that
should be re-typed (e.g. a \`feedback\` note that's actually a durable \`user\`
fact). Use \`remember\`/\`forget\` to apply changes. Reply with a short summary
of what you changed (or "No changes needed" if memory is already tidy).`;

async function runReorganizeMemory(userId: string): Promise<void> {
  const db = getDb();
  const sessionId = newId();
  const title = `Memory reorganization — ${new Date().toISOString().slice(0, 10)}`;
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(sessionId, userId, title);

  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', REORGANIZE_MEMORY_PROMPT);

  await runAgentTurn(userId, sessionId, messageId);
}

export async function runScheduledTask(userId: string, taskId: string): Promise<void> {
  const task = getScheduledTaskForUser(taskId, userId);
  if (!task) throw new Error(`Scheduled task ${taskId} not found`);

  switch (task.type) {
    case 'reorganize_memory':
      await runReorganizeMemory(userId);
      break;
    default:
      throw new Error(`Unknown scheduled task type: ${task.type}`);
  }

  markScheduledTaskRun(task.id, Math.floor(Date.now() / 1000), task.interval_hours);
}
