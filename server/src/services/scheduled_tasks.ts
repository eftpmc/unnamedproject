import { getDb, getScheduledTaskForUser, markScheduledTaskRun } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { runAgentTurn } from './agent.js';

const REORGANIZE_MEMORY_PROMPT = `Review your stored memory using \`recall\`. Look for: duplicate or
overlapping entries to merge, outdated/stale facts to \`forget\`, vague
entries that should be split into more specific ones, and entries that
should be re-typed (e.g. a \`feedback\` note that's actually a durable \`user\`
fact). Use \`remember\`/\`forget\` to apply changes. Reply with a short summary
of what you changed (or "No changes needed" if memory is already tidy).`;

function createSession(userId: string, title: string, prompt: string, pinnedSpaceId: string | null): { sessionId: string; messageId: string } {
  const db = getDb();
  const sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id, title, pinned_space_id) VALUES (?,?,?,?)')
    .run(sessionId, userId, title, pinnedSpaceId);
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
    .run(messageId, sessionId, 'user', prompt);
  return { sessionId, messageId };
}

async function runReorganizeMemory(userId: string, pinnedSpaceId: string | null): Promise<void> {
  const title = `Memory reorganization — ${new Date().toISOString().slice(0, 10)}`;
  const { sessionId, messageId } = createSession(userId, title, REORGANIZE_MEMORY_PROMPT, pinnedSpaceId);
  await runAgentTurn(userId, sessionId, messageId);
}

async function runCustomPrompt(userId: string, prompt: string, pinnedSpaceId: string | null): Promise<void> {
  const title = `Scheduled task — ${new Date().toISOString().slice(0, 10)}`;
  const { sessionId, messageId } = createSession(userId, title, prompt, pinnedSpaceId);
  await runAgentTurn(userId, sessionId, messageId);
}

export async function runScheduledTask(userId: string, taskId: string): Promise<void> {
  const task = getScheduledTaskForUser(taskId, userId);
  if (!task) throw new Error(`Scheduled task ${taskId} not found`);

  const pinnedSpaceId = task.pinned_space_id ?? null;

  switch (task.type) {
    case 'reorganize_memory':
      await runReorganizeMemory(userId, pinnedSpaceId);
      break;
    case 'custom_prompt':
      if (!task.prompt) throw new Error('custom_prompt task has no prompt set');
      await runCustomPrompt(userId, task.prompt, pinnedSpaceId);
      break;
    default:
      throw new Error(`Unknown scheduled task type: ${task.type}`);
  }

  markScheduledTaskRun(task.id, Math.floor(Date.now() / 1000), task.interval_hours);
}
