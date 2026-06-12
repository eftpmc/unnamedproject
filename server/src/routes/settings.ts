import { Router } from 'express';
import { getProjectsRoot, setProjectsRoot, getAgentBudgets, setAgentBudget } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({ projects_root: getProjectsRoot(userId), agent_budgets: getAgentBudgets(userId) });
});

router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root } = req.body as { projects_root?: string };
  setProjectsRoot(userId, projects_root?.trim() ?? '');
  res.json({ projects_root: getProjectsRoot(userId), agent_budgets: getAgentBudgets(userId) });
});

router.put('/agent-budgets', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { claude_code, codex } = req.body as { claude_code?: number | null; codex?: number | null };
  if (claude_code !== undefined) setAgentBudget(userId, 'claude_code', claude_code);
  if (codex !== undefined) setAgentBudget(userId, 'codex', codex);
  res.json({ agent_budgets: getAgentBudgets(userId) });
});

export default router;
