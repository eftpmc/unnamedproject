import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  createPipeline,
  deletePipeline,
  getPipelineById,
  getPipelineTasks,
  getSpaceForUser,
  createPlan,
  getDb,
  type DbPlanStep,
} from '../db/index.js';
import { newId } from '../lib/ids.js';
import { runPlanAutoDispatch } from '../services/agent.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { spaceId } = req.params as { spaceId: string };
  if (!getSpaceForUser(spaceId, userId)) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  const pipelines = getDb()
    .prepare('SELECT * FROM pipelines WHERE space_id = ? ORDER BY created_at DESC')
    .all(spaceId) as Array<{ id: string }>;
  const withCounts = pipelines.map(p => {
    const tasks = getPipelineTasks(p.id);
    return { ...p, task_count: tasks.length, agents: [...new Set(tasks.map(t => t.agent))] };
  });
  res.json({ pipelines: withCounts });
});

router.post('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { spaceId } = req.params as { spaceId: string };
  if (!getSpaceForUser(spaceId, userId)) {
    res.status(404).json({ error: 'Space not found' });
    return;
  }
  const { title, description, tasks } = req.body as {
    title?: string;
    description?: string | null;
    tasks?: Array<{
      title: string;
      agent: DbPlanStep['agent'];
      prompt?: string | null;
      depends_on?: number[];
      tool_args?: Record<string, unknown> | null;
    }>;
  };
  if (!title?.trim() || !Array.isArray(tasks) || tasks.length === 0) {
    res.status(400).json({ error: 'title and at least one task required' });
    return;
  }
  const created = createPipeline(spaceId, title.trim(), description ?? null, tasks);
  res.status(201).json(created);
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { spaceId } = req.params as { spaceId: string; id: string };
  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline || pipeline.space_id !== spaceId) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  const tasks = getPipelineTasks(pipeline.id);
  res.json({ pipeline, tasks });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { spaceId } = req.params as { spaceId: string; id: string };
  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline || pipeline.space_id !== spaceId) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  deletePipeline(req.params.id, userId);
  res.json({ ok: true });
});

router.post('/:id/run', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { spaceId } = req.params as { spaceId: string; id: string };
  const { title, on_error } = req.body as {
    title?: string;
    on_error?: 'stop' | 'continue';
  };

  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline || pipeline.space_id !== spaceId) {
    res.status(404).json({ error: 'Pipeline not found' });
    return;
  }
  const space = getSpaceForUser(spaceId, userId)!;

  const ptasks = getPipelineTasks(pipeline.id);

  // Create a synthetic session for execution context
  const sessionId = newId();
  const messageId = newId();
  const db = getDb();
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(
    sessionId, userId, `Pipeline: ${title ?? pipeline.title}`,
  );
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(
    messageId, sessionId, 'user', `Run pipeline: ${pipeline.title} in space ${space.name}`,
  );

  const { plan } = createPlan(
    pipeline.space_id,
    sessionId,
    title ?? pipeline.title,
    ptasks.map(pt => ({
      title: pt.title,
      agent: pt.agent as DbPlanStep['agent'],
      prompt: pt.prompt,
      depends_on: pt.depends_on ? (JSON.parse(pt.depends_on) as number[]) : [],
      tool_args: pt.tool_args ? JSON.parse(pt.tool_args) : undefined,
    })),
  );

  res.json({ plan_id: plan.id, space_id: plan.space_id });

  // Fire-and-forget: run plan steps in background
  runPlanAutoDispatch(plan.id, userId, messageId, sessionId, on_error ?? 'stop').catch(err => {
    console.error(`Pipeline run failed (plan ${plan.id}):`, err);
  });
});

export default router;
