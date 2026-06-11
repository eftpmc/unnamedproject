import { Router } from 'express';
import { getProjectsRoot, setProjectsRoot } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({ projects_root: getProjectsRoot(userId) });
});

router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root } = req.body as { projects_root?: string };
  if (!projects_root || !projects_root.trim()) { res.status(400).json({ error: 'projects_root required' }); return; }
  setProjectsRoot(userId, projects_root.trim());
  res.json({ projects_root: projects_root.trim() });
});

export default router;
