import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  cancelCampaign,
  createCampaign,
  getCampaignById,
  getCampaignTasks,
  getDb,
  getProjectForUser,
  getRecentCampaignsForUser,
  resumeCampaign,
  type DbCampaignTask,
} from '../db/index.js';
import { newId } from '../lib/ids.js';
import { killProcess } from '../lib/process-registry.js';
import { completeExecution } from '../services/executor.js';
import { broadcast } from '../services/socket.js';
import { runCampaignAutoDispatch } from '../services/agent.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({ campaigns: getRecentCampaignsForUser(userId) });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { project_id, title, tasks, session_id } = req.body as {
    project_id?: string;
    title?: string;
    tasks?: Array<{ title: string; agent: string }>;
    session_id?: string;
  };
  if (!project_id || !title || !Array.isArray(tasks) || tasks.length === 0) {
    res.status(400).json({ error: 'project_id, title, and tasks required' });
    return;
  }
  const project = getProjectForUser(project_id, userId);
  if (!project) { res.status(404).json({ error: 'Project not found' }); return; }

  const { campaign, tasks: createdTasks } = createCampaign(
    project_id, session_id ?? null, title, tasks as Array<{ title: string; agent: DbCampaignTask['agent'] }>
  );
  res.status(201).json({
    campaign_id: campaign.id,
    project_id: campaign.project_id,
    tasks: createdTasks,
  });
});

router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const campaign = getCampaignById(req.params.id);
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const project = getProjectForUser(campaign.project_id, userId);
  if (!project) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const tasks = getCampaignTasks(campaign.id);
  res.json({ campaign, tasks });
});

router.post('/:id/cancel', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const campaign = getCampaignById(req.params.id);
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const project = getProjectForUser(campaign.project_id, userId);
  if (!project) { res.status(404).json({ error: 'Campaign not found' }); return; }
  if (campaign.status !== 'running') { res.status(400).json({ error: 'Campaign is not running' }); return; }

  for (const task of getCampaignTasks(campaign.id)) {
    if (task.status === 'running' && task.execution_id) {
      killProcess(task.execution_id);
      completeExecution(task.execution_id, userId, 'error', 'Cancelled');
    }
  }
  const updated = cancelCampaign(campaign.id)!;
  for (const task of getCampaignTasks(campaign.id)) {
    broadcast(userId, { type: 'campaign_task_updated', taskId: task.id, status: task.status });
  }
  broadcast(userId, { type: 'campaign_updated', campaignId: campaign.id, status: updated.status });
  res.json({ campaign: updated });
});

router.post('/:id/resume', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const campaign = getCampaignById(req.params.id);
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const project = getProjectForUser(campaign.project_id, userId);
  if (!project) { res.status(404).json({ error: 'Campaign not found' }); return; }
  if (campaign.status === 'cancelled') { res.status(400).json({ error: 'Cancelled campaigns cannot be resumed' }); return; }
  if (campaign.status !== 'error') { res.status(400).json({ error: 'Only failed campaigns can be resumed' }); return; }

  const result = resumeCampaign(campaign.id);
  if (!result) { res.status(500).json({ error: 'Resume failed' }); return; }

  for (const task of result.tasks) {
    broadcast(userId, { type: 'campaign_task_updated', taskId: task.id, status: task.status });
  }
  broadcast(userId, { type: 'campaign_updated', campaignId: campaign.id, status: result.campaign.status });
  res.json({ campaign: result.campaign, tasks: result.tasks });

  // Dispatch resumed tasks in background
  const db = getDb();
  let sessionId = campaign.session_id;
  if (!sessionId) {
    sessionId = newId();
    db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(
      sessionId, userId, `Resumed: ${campaign.title}`,
    );
  }
  const messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(
    messageId, sessionId, 'user', `Resume campaign: ${campaign.title}`,
  );
  runCampaignAutoDispatch(campaign.id, userId, messageId, sessionId).catch(err => {
    console.error(`Campaign resume dispatch failed (${campaign.id}):`, err);
  });
});

export default router;
