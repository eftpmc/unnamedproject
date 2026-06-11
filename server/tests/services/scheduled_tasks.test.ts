import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb, createScheduledTask, getScheduledTaskForUser } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));

const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { runScheduledTask } = await import('../../src/services/scheduled_tasks.js');

const userId = newId();

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `sched-${userId}@test.com`, 'x');
});

describe('scheduled_tasks service', () => {
  it('runs a reorganize_memory task by creating a session, message, and calling runAgentTurn', async () => {
    const taskId = createScheduledTask(userId, 'reorganize_memory', 24);

    await runScheduledTask(userId, taskId);

    const db = getDb();
    const sessions = db.prepare("SELECT id, title FROM sessions WHERE user_id = ? AND title LIKE 'Memory reorganization%'").all(userId) as { id: string; title: string }[];
    expect(sessions.length).toBe(1);

    const messages = db.prepare('SELECT role, content FROM messages WHERE session_id = ?').all(sessions[0].id) as { role: string; content: string }[];
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('Review your stored memory using `recall`');

    expect(runAgentTurnMock).toHaveBeenCalledWith(userId, sessions[0].id, expect.any(String));

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
    expect(updated?.next_run_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('throws for an unknown task type', async () => {
    const taskId = createScheduledTask(userId, 'unknown_type', 24);
    await expect(runScheduledTask(userId, taskId)).rejects.toThrow('Unknown scheduled task type');
  });
});
