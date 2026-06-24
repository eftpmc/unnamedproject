import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import {
  initDb,
  getDb,
  createPlan,
  getPlansForProject,
  getPlanById,
  getPlanSteps,
  updatePlanStepStatus,
  maybeCompletePlan,
} from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';

// Direct DB-layer coverage for the plan machinery (formerly "campaigns"), and a
// regression for the foreign-key repair migration: inserting plan steps and an
// artifact must not fail against the dropped campaign tables.
let userId: string;
let projectId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const db = getDb();
  userId = newId();
  projectId = newId();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)')
    .run(userId, `plans-${Date.now()}@test.com`, 'x');
  db.prepare('INSERT INTO spaces (id, user_id, name, enabled_connection_ids) VALUES (?,?,?,?)')
    .run(projectId, userId, 'plan-project', '[]');
});

describe('plans DB layer', () => {
  it('creates a plan with steps and resolves depends_on indices to step IDs', () => {
    const { plan, steps } = createPlan(projectId, null, 'Ship it', [
      { title: 'build', agent: 'eval', prompt: 'npm run build' },
      { title: 'test', agent: 'eval', prompt: 'npm test', depends_on: [0] },
    ]);
    expect(plan.status).toBe('running');
    expect(steps).toHaveLength(2);
    expect(steps[0].plan_id).toBe(plan.id);
    // step 1 depends on step 0 — stored as the resolved step ID, not the index
    expect(steps[1].depends_on).toBe(JSON.stringify([steps[0].id]));
  });

  it('lists plans for a project and reads one back by id', () => {
    const { plan } = createPlan(projectId, null, 'Another plan', [
      { title: 'do', agent: 'subagent' },
    ]);
    const list = getPlansForProject(projectId);
    expect(list.some(p => p.id === plan.id)).toBe(true);
    expect(getPlanById(plan.id)?.title).toBe('Another plan');
  });

  it('completes a plan once every step is done', () => {
    const { plan, steps } = createPlan(projectId, null, 'Two-step', [
      { title: 'a', agent: 'eval', prompt: 'true' },
      { title: 'b', agent: 'eval', prompt: 'true' },
    ]);
    updatePlanStepStatus(steps[0].id, 'done');
    expect(maybeCompletePlan(plan.id)).toBe('running');
    updatePlanStepStatus(steps[1].id, 'done');
    expect(maybeCompletePlan(plan.id)).toBe('done');
  });

  it('marks a plan errored when a step fails and none are still running', () => {
    const { plan, steps } = createPlan(projectId, null, 'Failing', [
      { title: 'boom', agent: 'eval', prompt: 'false' },
    ]);
    updatePlanStepStatus(steps[0].id, 'error');
    expect(maybeCompletePlan(plan.id)).toBe('error');
  });

  it('allows inserting an item that references a plan step', () => {
    const { plan, steps } = createPlan(projectId, null, 'With item', [
      { title: 'gen', agent: 'subagent' },
    ]);
    const itemId = newId();
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO space_items (id, space_id, type, name, source_plan_id, source_step_id)
           VALUES (?,?,?,?,?,?)`
        )
        .run(itemId, projectId, 'note', 'out', plan.id, steps[0].id)
    ).not.toThrow();
    getDb().prepare('INSERT INTO space_notes (item_id, content) VALUES (?,?)').run(itemId, 'body');
    expect(getPlanSteps(plan.id)).toHaveLength(1);
  });
});
