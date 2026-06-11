import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { initDb, getDb, createScheduledTask, getScheduledTaskForUser } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

vi.mock('../src/services/socket.js', () => ({ broadcast: vi.fn(), initSocket: vi.fn() }));
const runAgentTurnMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/services/agent.js', () => ({ runAgentTurn: runAgentTurnMock }));

const { app } = await import('../src/index.js');

let token: string;
let userId: string;
let taskId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `sched-route-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64').toString());
  userId = payload.userId;

  // Registration bootstraps a reorganize_memory task — fetch its id.
  const tasksRes = await request(app).get('/scheduled-tasks').set('Authorization', `Bearer ${token}`);
  taskId = tasksRes.body[0].id;
});

describe('scheduled-tasks routes', () => {
  it('GET /scheduled-tasks lists the bootstrapped reorganize_memory task', async () => {
    const res = await request(app).get('/scheduled-tasks').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0]).toMatchObject({ type: 'reorganize_memory', interval_hours: 24, enabled: 1 });
  });

  it('PATCH /scheduled-tasks/:id updates enabled and interval_hours', async () => {
    const res = await request(app)
      .patch(`/scheduled-tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false, interval_hours: 12 });
    expect(res.status).toBe(200);

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.enabled).toBe(0);
    expect(updated?.interval_hours).toBe(12);
  });

  it('PATCH /scheduled-tasks/:id 404s for another user\'s task', async () => {
    const otherUserId = newId();
    getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(otherUserId, `other-${otherUserId}@test.com`, 'x');
    const otherTaskId = createScheduledTask(otherUserId, 'reorganize_memory', 24);
    const res = await request(app)
      .patch(`/scheduled-tasks/${otherTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);
  });

  it('POST /scheduled-tasks/:id/run runs the task immediately', async () => {
    const res = await request(app)
      .post(`/scheduled-tasks/${taskId}/run`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(runAgentTurnMock).toHaveBeenCalled();

    const updated = getScheduledTaskForUser(taskId, userId);
    expect(updated?.last_run_at).not.toBeNull();
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/scheduled-tasks');
    expect(res.status).toBe(401);
  });
});
