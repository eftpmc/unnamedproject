import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  cancelPlan,
  createPlan,
  getPlanById,
  getPlanSteps,
  getDb,
  getSpaceForUser,
  getRecentPlansForUser,
  resumePlan,
  type DbPlanStep,
} from '../db/index.js';
import { newId } from '../lib/ids.js';
import { killProcess } from '../lib/process-registry.js';
import { completeExecution } from '../services/executor.js';
import { broadcast } from '../services/socket.js';
import { runPlanAutoDispatch } from '../services/agent.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({ plans: getRecentPlansForUser(userId) });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { space_id, title, steps, session_id } = req.body as {
    space_id?: string;
    title?: string;
    steps?: Array<{ title: string; agent: string }>;
    session_id?: string;
  };
  if (!space_id || !title || !Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ error: 'space_id, title, and steps required' });
    return;
  }
  const space = getSpaceForUser(space_id, userId);
  if (!space) { res.status(404).json({ error: 'Space not found' }); return; }

  const { plan, steps: createdSteps } = createPlan(
    space_id, session_id ?? null, title, steps as Array<{ title: string; agent: DbPlanStep['agent'] }>
  );
  res.status(201).json({
    plan_id: plan.id,
    space_id: plan.space_id,
    steps: createdSteps,
  });
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const plan = getPlanById(req.params.id);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  const project = getSpaceForUser(plan.space_id, userId);
  if (!project) { res.status(404).json({ error: 'Plan not found' }); return; }
  const steps = getPlanSteps(plan.id);
  res.json({ plan, steps });
});

router.post('/:id/cancel', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const plan = getPlanById(req.params.id);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  const project = getSpaceForUser(plan.space_id, userId);
  if (!project) { res.status(404).json({ error: 'Plan not found' }); return; }
  if (plan.status !== 'running') { res.status(400).json({ error: 'Plan is not running' }); return; }

  for (const step of getPlanSteps(plan.id)) {
    if (step.status === 'running' && step.execution_id) {
      killProcess(step.execution_id);
      completeExecution(step.execution_id, userId, 'error', 'Cancelled');
    }
  }
  const updated = cancelPlan(plan.id)!;
  for (const step of getPlanSteps(plan.id)) {
    broadcast(userId, { type: 'plan_step_updated', stepId: step.id, status: step.status });
  }
  broadcast(userId, { type: 'plan_updated', planId: plan.id, status: updated.status });
  res.json({ plan: updated });
});

router.post('/:id/resume', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const plan = getPlanById(req.params.id);
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  const project = getSpaceForUser(plan.space_id, userId);
  if (!project) { res.status(404).json({ error: 'Plan not found' }); return; }
  if (plan.status === 'cancelled') { res.status(400).json({ error: 'Cancelled plans cannot be resumed' }); return; }
  if (plan.status !== 'error') { res.status(400).json({ error: 'Only failed plans can be resumed' }); return; }

  const result = resumePlan(plan.id);
  if (!result) { res.status(500).json({ error: 'Resume failed' }); return; }

  for (const step of result.steps) {
    broadcast(userId, { type: 'plan_step_updated', stepId: step.id, status: step.status });
  }
  broadcast(userId, { type: 'plan_updated', planId: plan.id, status: result.plan.status });
  res.json({ plan: result.plan, steps: result.steps });

  // Dispatch resumed steps in background
  const db = getDb();
  let sessionId = plan.session_id;
  if (!sessionId) {
    sessionId = newId();
    db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(
      sessionId, userId, `Resumed: ${plan.title}`,
    );
  }
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(
    messageId, sessionId, 'user', `Resume plan: ${plan.title}`,
  );
  runPlanAutoDispatch(plan.id, userId, messageId, sessionId).catch(err => {
    console.error(`Plan resume dispatch failed (${plan.id}):`, err);
  });
});

export default router;
