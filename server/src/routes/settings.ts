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
  setProjectsRoot(userId, projects_root?.trim() ?? '');
  res.json({ projects_root: getProjectsRoot(userId) });
});

export default router;
