import { Router } from 'express';
import simpleGit from 'simple-git';
import { createSessionEvent, getDb, getSpaceForUser, getSessionEvents, linkSessionProject, getSessionProjectLinks } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { DEFAULT_EFFORT, isEffortLevel } from '../services/effort.js';
import { stopAgentTurn, getActiveSessionIds } from '../services/agent.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;
  const PAGE = 100;

  const params: unknown[] = [userId];
  let sql = 'SELECT id, title, effort, pinned_space_id, created_at, updated_at FROM sessions WHERE user_id = ?';
  if (before) {
    sql += ' AND updated_at < ?';
    params.push(before);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ${PAGE}`;
  res.json(getDb().prepare(sql).all(...params));
});

router.get('/:id/events', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const projects = getSessionProjectLinks(req.params.id).map(p => ({
    id: p.id,
    name: p.name,
    source: p.source,
  }));
  res.json({
    events: getSessionEvents(req.params.id).map(event => ({
      ...event,
      metadata: JSON.parse(event.metadata || '{}'),
    })),
    projects,
  });
});

router.get('/:id/status', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  const activeTurn = getDb()
    .prepare(`
      SELECT id, user_message_id as userMessageId, started_at as startedAt
      FROM session_turns
      WHERE session_id = ? AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(req.params.id) as { id: string; userMessageId: string; startedAt: number } | undefined;

  const activeExecution = getDb()
    .prepare(`
      SELECT id, status, tool, created_at as createdAt
      FROM executions
      WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)
        AND status IN ('running','awaiting_approval')
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(req.params.id) as { id: string; status: string; tool: string; createdAt: number } | undefined;

  res.json({
    active: !!activeTurn || !!activeExecution,
    turn: activeTurn ?? null,
    execution: activeExecution ?? null,
  });
});

router.get('/search', (req, res) => {
  const { userId } = req as AuthedRequest;
  const q = (req.query.q as string | undefined)?.trim();
  if (!q) { res.json([]); return; }
  const pattern = `%${q}%`;
  const rows = getDb()
    .prepare(`
      SELECT DISTINCT s.id, s.title, s.effort, s.pinned_space_id, s.created_at, s.updated_at
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.user_id = ? AND (s.title LIKE ? OR m.content LIKE ?)
      ORDER BY s.updated_at DESC
      LIMIT 50
    `)
    .all(userId, pattern, pattern);
  res.json(rows);
});


router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { effort, title, pinned_project_id, pinned_space_id: pinnedSpaceIdBody } = req.body as { effort?: string; title?: string; pinned_project_id?: string | null; pinned_space_id?: string | null };
  // Accept pinned_space_id (new) or pinned_project_id (legacy alias)
  const pinnedSpaceUpdate = pinnedSpaceIdBody !== undefined ? pinnedSpaceIdBody : pinned_project_id;

  if (effort === undefined && title === undefined && pinnedSpaceUpdate === undefined) {
    res.status(400).json({ error: 'effort, title, or pinned_space_id required' });
    return;
  }
  if (effort !== undefined && !isEffortLevel(effort)) {
    res.status(400).json({ error: 'effort must be one of: low, medium, high' });
    return;
  }

  const session = getDb()
    .prepare('SELECT id, pinned_space_id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId) as { id: string; pinned_space_id: string | null } | undefined;
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

  if (effort !== undefined) {
    getDb().prepare('UPDATE sessions SET effort = ? WHERE id = ?').run(effort, req.params.id);
  }
  if (title !== undefined) {
    getDb().prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, req.params.id);
  }
  if (pinnedSpaceUpdate !== undefined) {
    const space = pinnedSpaceUpdate ? getSpaceForUser(pinnedSpaceUpdate, userId) : null;
    if (pinnedSpaceUpdate && !space) {
      res.status(404).json({ error: 'Space not found' });
      return;
    }
    // When unpinning, backfill the previously-pinned space into project links so history is preserved
    if (!pinnedSpaceUpdate && session.pinned_space_id) {
      linkSessionProject(req.params.id, session.pinned_space_id, 'user');
    }
    getDb().prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(pinnedSpaceUpdate, req.params.id);
    if (pinnedSpaceUpdate) {
      linkSessionProject(req.params.id, space!.id, 'user');
      createSessionEvent({
        sessionId: req.params.id,
        type: 'scope_changed',
        title: `Scoped to ${space!.name}`,
        spaceId: space!.id,
        metadata: { source: 'user' },
      });
    } else {
      createSessionEvent({
        sessionId: req.params.id,
        type: 'scope_changed',
        title: 'Back to Auto',
        metadata: { source: 'user' },
      });
    }
  }
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { title } = req.body as { title?: string };
  // Clean up abandoned empty sessions before creating a new one
  getDb()
    .prepare(`DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT DISTINCT session_id FROM messages WHERE session_id IS NOT NULL)`)
    .run(userId);
  const id = newId();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, title, effort) VALUES (?,?,?,?)')
    .run(id, userId, title ?? null, DEFAULT_EFFORT);
  res.status(201).json({ id });
});

router.get('/active', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  // Filter to only sessions belonging to this user
  const activeIds = getActiveSessionIds();
  if (activeIds.length === 0) { res.json({ ids: [] }); return; }
  const placeholders = activeIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id FROM sessions WHERE id IN (${placeholders}) AND user_id = ?`)
    .all(...activeIds, userId) as { id: string }[];
  res.json({ ids: rows.map(r => r.id) });
});

router.post('/:id/stop', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const session = getDb()
    .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
  const stopped = stopAgentTurn(req.params.id);
  res.json({ ok: true, stopped });
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
    SELECT w.id, w.branch, w.worktree_path, pr.repo_path, pr.name AS project_name
    FROM agent_worktrees w
    JOIN projects pr ON pr.id = w.project_id
    JOIN spaces p ON p.id = pr.space_id
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

router.get('/:id/worktree/diff', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const wt = getDb().prepare(`
    SELECT w.worktree_path, p.user_id
    FROM agent_worktrees w
    JOIN projects pr ON pr.id = w.project_id
    JOIN spaces p ON p.id = pr.space_id
    WHERE w.session_id = ? AND p.user_id = ?
  `).get(req.params.id, userId) as { worktree_path: string } | undefined;

  if (!wt) { res.status(404).json({ error: 'No worktree for this session' }); return; }

  try {
    const git = simpleGit(wt.worktree_path);
    const diff = await git.diff(['HEAD']);
    res.json({ diff: diff || '' });
  } catch {
    res.json({ diff: '' });
  }
});

router.post('/:id/merge', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const wt = getDb().prepare(`
    SELECT w.branch, pr.repo_path
    FROM agent_worktrees w
    JOIN projects pr ON pr.id = w.project_id
    JOIN spaces p ON p.id = pr.space_id
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
