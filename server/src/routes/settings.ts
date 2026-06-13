import { Router } from 'express';
import { getProjectsRoot, setProjectsRoot, getAgentBudgets, setAgentBudget, getPermissionProfile, setPermissionProfile } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isPermissionProfile } from '../services/permissions.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({
    projects_root: getProjectsRoot(userId),
    agent_budgets: getAgentBudgets(userId),
    permission_profile: getPermissionProfile(userId),
  });
});

router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root, permission_profile } = req.body as { projects_root?: string; permission_profile?: unknown };
  if (permission_profile !== undefined && !isPermissionProfile(permission_profile)) {
    res.status(400).json({ error: 'permission_profile must be one of fast, trusted, strict' });
    return;
  }
  setProjectsRoot(userId, projects_root?.trim() ?? '');
  if (permission_profile !== undefined) setPermissionProfile(userId, permission_profile);
  res.json({
    projects_root: getProjectsRoot(userId),
    agent_budgets: getAgentBudgets(userId),
    permission_profile: getPermissionProfile(userId),
  });
});

router.put('/agent-budgets', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { claude_code, codex } = req.body as { claude_code?: number | null; codex?: number | null };
  if (claude_code !== undefined) setAgentBudget(userId, 'claude_code', claude_code);
  if (codex !== undefined) setAgentBudget(userId, 'codex', codex);
  res.json({ agent_budgets: getAgentBudgets(userId), permission_profile: getPermissionProfile(userId) });
});

export default router;
