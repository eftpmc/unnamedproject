import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  createCampaign,
  getCampaignById,
  getCampaignTasks,
  getProjectForUser,
  type DbCampaignTask,
} from '../db/index.js';

const router = Router();
router.use(requireAuth);

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
  const campaign = getCampaignById(req.params.id);
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  const tasks = getCampaignTasks(campaign.id);
  res.json({ campaign, tasks });
});

export default router;
