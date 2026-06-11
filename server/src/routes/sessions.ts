import { Router } from 'express';
import simpleGit from 'simple-git';
import { getDb } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { DEFAULT_EFFORT, isEffortLevel, getModelsForEffort } from '../services/anthropic.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const rows = getDb()
    .prepare('SELECT id, title, effort, model, pinned_project_id, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId);
  res.json(rows);
});

router.get('/models', async (req, res) => {
  const { userId } = req as AuthedRequest;
  const { effort } = req.query as { effort?: string };
  if (!isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }
  try {
    const models = await getModelsForEffort(userId, effort);
    res.json(models);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { effort, model, title, pinned_project_id } = req.body as { effort?: string; model?: string | null; title?: string; pinned_project_id?: string | null };

  if (effort === undefined && model === undefined && title === undefined && pinned_project_id === undefined) {
    res.status(400).json({ error: 'effort, model, title, or pinned_project_id required' });
    return;
  }
  if (effort !== undefined && !isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }
  if (model !== undefined && model !== null && typeof model !== 'string') {
    res.status(400).json({ error: 'model must be a string or null' });
    return;
  }

  const session = getDb().prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  if (effort !== undefined) {
    getDb().prepare('UPDATE sessions SET effort = ? WHERE id = ?').run(effort, req.params.id);
  }
  if (model !== undefined) {
    getDb().prepare('UPDATE sessions SET model = ? WHERE id = ?').run(model, req.params.id);
  }
  if (title !== undefined) {
    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, req.params.id);
  }
  if (pinned_project_id !== undefined) {
    getDb().prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(pinned_project_id, req.params.id);
  }
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title } = req.body as { title?: string };
  const id = newId();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, title, effort) VALUES (?,?,?,?)')
    .run(id, userId, title ?? null, DEFAULT_EFFORT);
  res.status(201).json({ id });
});

router.delete('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/:id/worktree', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const wt = getDb().prepare(`
    SELECT w.id, w.branch, w.worktree_path, p.repo_path, p.name AS project_name
    FROM agent_worktrees w
    JOIN projects p ON p.id = w.project_id
    WHERE w.session_id = ? AND p.user_id = ?
  `).get(req.params.id, userId) as { id: string; branch: string; worktree_path: string; repo_path: string; project_name: string } | undefined;

  if (!wt) { res.json(null); return; }

  try {
    const git = simpleGit(wt.worktree_path);
    const status = await git.status();
    let ahead = 0;
    for (const base of ['main', 'master']) {
      try {
        const out = await git.raw(['rev-list', '--count', `${base}..HEAD`]);
        ahead = parseInt(out.trim(), 10) || 0;
        break;
      } catch { /* try next */ }
    }
    res.json({ branch: wt.branch, project_name: wt.project_name, files_changed: status.files.length, ahead, has_uncommitted: status.files.length > 0 });
  } catch {
    res.json({ branch: wt.branch, project_name: wt.project_name, files_changed: 0, ahead: 0, has_uncommitted: false });
  }
});

router.post('/:id/merge', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const wt = getDb().prepare(`
    SELECT w.branch, p.repo_path
    FROM agent_worktrees w
    JOIN projects p ON p.id = w.project_id
    WHERE w.session_id = ? AND p.user_id = ?
  `).get(req.params.id, userId) as { branch: string; repo_path: string } | undefined;

  if (!wt) { res.status(404).json({ error: 'No worktree for this session' }); return; }

  try {
    await simpleGit(wt.repo_path).merge([wt.branch]);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(422).json({ error: msg });
  }
});

export default router;
