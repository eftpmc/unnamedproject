import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'fs';
import request from 'supertest';

vi.mock('../../src/services/agent.js', () => ({
  runPlanAutoDispatch: vi.fn().mockResolvedValue({ done: 1, errors: [] }),
}));

import { getDb, initDb } from '../../src/db/index.js';
import { signToken } from '../../src/lib/jwt.js';
import pipelinesRouter from '../../src/routes/pipelines.js';

const app = express();
app.use(express.json());
app.use('/spaces/:spaceId/pipelines', pipelinesRouter);

let authorization: string;

beforeAll(() => {
  process.env.DATA_DIR = `/tmp/pipelines-route-test-${Date.now()}`;
  fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1', 'pipelines@test.com', 'h')").run();
  getDb().prepare("INSERT INTO spaces (id, user_id, name) VALUES ('s1', 'u1', 'Space One')").run();
  getDb().prepare("INSERT INTO spaces (id, user_id, name) VALUES ('s2', 'u1', 'Space Two')").run();
  authorization = `Bearer ${signToken('u1')}`;
});

describe('Space-owned pipeline routes', () => {
  it('creates and lists pipelines only within the owning Space', async () => {
    const created = await request(app)
      .post('/spaces/s1/pipelines')
      .set('Authorization', authorization)
      .send({
        title: 'Verify',
        tasks: [{ title: 'Test', agent: 'eval', prompt: 'npm test' }],
      });
    expect(created.status).toBe(201);
    expect(created.body.pipeline).toMatchObject({ space_id: 's1', title: 'Verify' });

    const owningList = await request(app).get('/spaces/s1/pipelines').set('Authorization', authorization);
    expect(owningList.body.pipelines).toHaveLength(1);

    const otherList = await request(app).get('/spaces/s2/pipelines').set('Authorization', authorization);
    expect(otherList.body.pipelines).toHaveLength(0);

    const crossSpace = await request(app)
      .get(`/spaces/s2/pipelines/${created.body.pipeline.id}`)
      .set('Authorization', authorization);
    expect(crossSpace.status).toBe(404);
  });

  it('runs in the pipeline owning Space without accepting a caller-selected Space', async () => {
    const created = await request(app)
      .post('/spaces/s1/pipelines')
      .set('Authorization', authorization)
      .send({
        title: 'Build',
        tasks: [{ title: 'Build', agent: 'eval', prompt: 'npm run build' }],
      });

    const run = await request(app)
      .post(`/spaces/s1/pipelines/${created.body.pipeline.id}/run`)
      .set('Authorization', authorization)
      .send({ space_id: 's2' });
    expect(run.status).toBe(200);
    expect(run.body.space_id).toBe('s1');

    const plan = getDb().prepare('SELECT space_id FROM plans WHERE id = ?').get(run.body.plan_id) as { space_id: string };
    expect(plan.space_id).toBe('s1');
  });
});
