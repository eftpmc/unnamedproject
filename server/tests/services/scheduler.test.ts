import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import { initDb, getDb, createScheduledTask, getScheduledTaskForUser } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { runDueScheduledTasks } = await import('../../src/services/scheduler.js');

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `scheduler-${userId}@test.com`, 'x');
});

afterEach(() => {
  runAgentTurnMock.mockClear();
});

describe('scheduler', () => {
  it('runs tasks whose next_run_at is due', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    // Force it due now.
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, taskId);

    await runDueScheduledTasks();

    expect(runAgentTurnMock).toHaveBeenCalled();
    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
  });

  it('does not run tasks that are not yet due', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    // createScheduledTask already sets next_run_at = now + 24h, so it's not due.

    await runDueScheduledTasks();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).toBeNull();
  });

  it('does not run disabled tasks', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ?, enabled = 0 WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, taskId);

    await runDueScheduledTasks();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).toBeNull();
  });

  it('continues to the next task if one fails', async () => {
    const failingTaskId = newId();
    getDb().prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, next_run_at) VALUES (?,?,?,?,?)')
      .run(failingTaskId, userId, 'unknown_type', 24, Math.floor(Date.now() / 1000) - 1);

    const okTaskId = createScheduledTask(userId, 'reorganize_memory', 24);
    getDb().prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, okTaskId);

    await runDueScheduledTasks();

    const okTask = getScheduledTaskForUser(okTaskId, userId);
    expect(okTask?.last_run_at).not.toBeNull();
  });
});
