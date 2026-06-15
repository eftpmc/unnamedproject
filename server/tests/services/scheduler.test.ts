import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runDueScheduledTasks } from '../../src/services/scheduler.js';
import { newId } from '../../src/lib/ids.js';

// runScheduledTask ultimately calls runAgentTurn which needs Anthropic + socket mocked
vi.mock('../../src/services/scheduled_tasks.js', () => ({
  runScheduledTask: vi.fn(),
}));

import { runScheduledTask } from '../../src/services/scheduled_tasks.js';
const runScheduledTaskMock = vi.mocked(runScheduledTask);

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
});

afterEach(() => {
  runScheduledTaskMock.mockReset();
  getDb().prepare('DELETE FROM scheduled_tasks').run();
});

describe('scheduler', () => {
  it('runs due tasks in parallel, not serially', async () => {
    const db = getDb();
    const userId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched-${userId}@test.com`, 'x');

    // Insert 2 tasks both due now
    const now = Math.floor(Date.now() / 1000);
    const task1Id = newId();
    const task2Id = newId();
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task1Id, userId, 'reorganize_memory', 24, 1, now - 10);
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task2Id, userId, 'reorganize_memory', 24, 1, now - 10);

    const events: string[] = [];
    runScheduledTaskMock
      .mockImplementationOnce(async () => {
        events.push('task1:start');
        await new Promise(resolve => setTimeout(resolve, 30));
        events.push('task1:end');
      })
      .mockImplementationOnce(async () => {
        events.push('task2:start');
        events.push('task2:end');
      });

    await runDueScheduledTasks();

    // If parallel: task2 starts before task1 ends
    expect(events).toEqual(['task1:start', 'task2:start', 'task2:end', 'task1:end']);
    // If serial: ['task1:start', 'task1:end', 'task2:start', 'task2:end']
  });

  it('continues running remaining tasks when one fails', async () => {
    const db = getDb();
    const userId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched2-${userId}@test.com`, 'x');

    const now = Math.floor(Date.now() / 1000);
    const task1Id = newId();
    const task2Id = newId();
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task1Id, userId, 'reorganize_memory', 24, 1, now - 10);
    db.prepare('INSERT INTO scheduled_tasks (id, user_id, type, interval_hours, enabled, next_run_at) VALUES (?,?,?,?,?,?)')
      .run(task2Id, userId, 'reorganize_memory', 24, 1, now - 10);

    runScheduledTaskMock
      .mockRejectedValueOnce(new Error('task1 failed'))
      .mockResolvedValueOnce(undefined);

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runDueScheduledTasks();

    expect(runScheduledTaskMock).toHaveBeenCalledTimes(2);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[scheduler]'), expect.anything());
    errSpy.mockRestore();
  });
});
