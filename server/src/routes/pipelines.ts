import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  createPipeline,
  deletePipeline,
  getPipelineById,
  getPipelineTasks,
  listPipelinesForUser,
  getProjectForUser,
  createCampaign,
  getDb,
  type DbCampaignTask,
} from '../db/index.js';
import { newId } from '../lib/ids.js';
import { runCampaignAutoDispatch } from '../services/agent.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const pipelines = listPipelinesForUser(userId);
  const withCounts = pipelines.map(p => {
    const tasks = getPipelineTasks(p.id);
    return { ...p, task_count: tasks.length, agents: [...new Set(tasks.map(t => t.agent))] };
  });
  res.json({ pipelines: withCounts });
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline) { res.status(404).json({ error: 'Pipeline not found' }); return; }
  const tasks = getPipelineTasks(pipeline.id);
  res.json({ pipeline, tasks });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline) { res.status(404).json({ error: 'Pipeline not found' }); return; }
  deletePipeline(req.params.id, userId);
  res.json({ ok: true });
});

router.post('/:id/run', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { project_id, title, on_error } = req.body as {
    project_id?: string;
    title?: string;
    on_error?: 'stop' | 'continue';
  };

  if (!project_id) { res.status(400).json({ error: 'project_id required' }); return; }

  const pipeline = getPipelineById(req.params.id, userId);
  if (!pipeline) { res.status(404).json({ error: 'Pipeline not found' }); return; }

  const project = getProjectForUser(project_id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const ptasks = getPipelineTasks(pipeline.id);

  // Create a synthetic session for execution context
  const sessionId = newId();
  const messageId = newId();
  const db = getDb();
  db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(
    sessionId, userId, `Pipeline: ${title ?? pipeline.title}`,
  );
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(
    messageId, sessionId, 'user', `Run pipeline: ${pipeline.title} on project ${project.name}`,
  );

  const { campaign } = createCampaign(
    project_id,
    sessionId,
    title ?? pipeline.title,
    ptasks.map(pt => ({
      title: pt.title,
      agent: pt.agent as DbCampaignTask['agent'],
      prompt: pt.prompt,
      depends_on: pt.depends_on ? (JSON.parse(pt.depends_on) as number[]) : [],
      tool_args: pt.tool_args ? JSON.parse(pt.tool_args) : undefined,
    })),
  );

  res.json({ campaign_id: campaign.id, project_id: campaign.project_id });

  // Fire-and-forget: run campaign tasks in background
  runCampaignAutoDispatch(campaign.id, userId, messageId, sessionId, on_error ?? 'stop').catch(err => {
    console.error(`Pipeline run failed (campaign ${campaign.id}):`, err);
  });
});

export default router;
