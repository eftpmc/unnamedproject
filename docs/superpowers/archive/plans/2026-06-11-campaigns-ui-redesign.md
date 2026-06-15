# Campaigns + UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add campaigns as first-class agent-delegated objects and redesign the project/chat UI to Refined Minimal style.

**Architecture:** Backend adds `campaigns`/`campaign_tasks` DB tables and a `create_campaign` agent tool; frontend adds a `CampaignCard` component, a tabbed project workspace page, and a campaign detail page. Chat view header is redesigned to show title + project context; projects page becomes a card grid.

**Tech Stack:** Express + better-sqlite3 (server), React + React Query + shadcn/ui + react-router-dom (web), WebSockets via the existing `ws` broadcast system.

---

## File Map

**Backend — new:**
- `server/src/routes/campaigns.ts` — REST routes for campaigns
- `server/src/tools/create_campaign.ts` — create_campaign tool implementation
- `server/tests/campaigns.test.ts` — route tests

**Backend — modified:**
- `server/src/db/index.ts` — add campaigns/campaign_tasks tables + helper functions
- `server/src/tools/definitions.ts` — add create_campaign tool def; add optional `campaign_task_id` to invoke_claude_code, invoke_codex, mcp_call
- `server/src/services/agent.ts` — add create_campaign case; thread campaign_task_id updates in invoke_claude_code/invoke_codex/mcp_call cases
- `server/src/index.ts` — register /campaigns route

**Frontend — new:**
- `web/src/components/CampaignCard.tsx` — campaign card rendered inside assistant messages
- `web/src/pages/ProjectPage.tsx` — tabbed project workspace (/projects/:id)
- `web/src/pages/CampaignPage.tsx` — campaign detail page (/projects/:id/campaigns/:cid)

**Frontend — modified:**
- `web/src/types.ts` — add Campaign, CampaignTask, WSCampaignTaskUpdated types
- `web/src/lib/api.ts` — add getCampaigns, getCampaign, getProjectCampaigns functions
- `web/src/App.tsx` — add /projects/:id and /projects/:id/campaigns/:cid routes
- `web/src/pages/AppLayout.tsx` — update isPageRoute to cover /projects/* paths
- `web/src/pages/ProjectsPage.tsx` — rewrite as full-width card grid
- `web/src/components/MessageList.tsx` — render CampaignCard for tool=create_campaign executions
- `web/src/components/ExecutionCard.tsx` — add color-coded left border by status
- `web/src/components/ChatView.tsx` — redesign header; move effort/model out of MessageInput
- `web/src/components/MessageInput.tsx` — remove effort/model selectors; accept only onSend + disabled

---

## Task 1: DB schema — campaigns + campaign_tasks

**Files:**
- Modify: `server/src/db/index.ts`

- [ ] **Step 1: Write the failing test**

Create `server/tests/campaigns.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb } from '../src/db/index.js';

let token: string;
let projectId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const res = await request(app)
    .post('/auth/register')
    .send({ email: `campaigns-${Date.now()}@test.com`, password: 'pass' });
  token = res.body.token;
  const proj = await request(app)
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'test-project', enabled_connection_ids: [] });
  projectId = proj.body.id;
});

describe('campaigns DB', () => {
  it('campaigns table exists with correct columns', () => {
    const cols = getDb()
      .prepare("SELECT name FROM pragma_table_info('campaigns')")
      .all() as { name: string }[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('project_id');
    expect(names).toContain('session_id');
    expect(names).toContain('title');
    expect(names).toContain('status');
    expect(names).toContain('created_at');
    expect(names).toContain('completed_at');
  });

  it('campaign_tasks table exists with correct columns', () => {
    const cols = getDb()
      .prepare("SELECT name FROM pragma_table_info('campaign_tasks')")
      .all() as { name: string }[];
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('campaign_id');
    expect(names).toContain('title');
    expect(names).toContain('agent');
    expect(names).toContain('status');
    expect(names).toContain('execution_id');
    expect(names).toContain('position');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- --reporter=verbose tests/campaigns.test.ts
```
Expected: FAIL — "no such table: campaigns"

- [ ] **Step 3: Add tables + helpers to db/index.ts**

Inside `applySchema()`, add after the `scheduled_tasks` table definition (before the closing backtick of `db.exec`):

```sql
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running','done','error','cancelled')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS campaign_tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      agent TEXT NOT NULL CHECK(agent IN ('claude_code','codex','mcp')),
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting','running','done','error')),
      execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );
```

Then add these exported helper functions at the bottom of `server/src/db/index.ts`:

```ts
export interface DbCampaign {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}

export interface DbCampaignTask {
  id: string;
  campaign_id: string;
  title: string;
  agent: 'claude_code' | 'codex' | 'mcp';
  status: 'waiting' | 'running' | 'done' | 'error';
  execution_id: string | null;
  position: number;
  created_at: number;
  completed_at: number | null;
}

export function createCampaign(
  projectId: string,
  sessionId: string | null,
  title: string,
  tasks: Array<{ title: string; agent: string }>
): { campaign: DbCampaign; tasks: DbCampaignTask[] } {
  const id = newId();
  getDb()
    .prepare('INSERT INTO campaigns (id, project_id, session_id, title) VALUES (?,?,?,?)')
    .run(id, projectId, sessionId, title);
  const insertTask = getDb().prepare(
    'INSERT INTO campaign_tasks (id, campaign_id, title, agent, position) VALUES (?,?,?,?,?)'
  );
  const createdTasks: DbCampaignTask[] = tasks.map((t, i) => {
    const taskId = newId();
    insertTask.run(taskId, id, t.title, t.agent, i);
    return {
      id: taskId, campaign_id: id, title: t.title,
      agent: t.agent as DbCampaignTask['agent'], status: 'waiting',
      execution_id: null, position: i, created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
    };
  });
  const campaign = getDb()
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .get(id) as DbCampaign;
  return { campaign, tasks: createdTasks };
}

export function getCampaignsForProject(projectId: string): DbCampaign[] {
  return getDb()
    .prepare('SELECT * FROM campaigns WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as DbCampaign[];
}

export function getCampaignById(id: string): DbCampaign | undefined {
  return getDb()
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .get(id) as DbCampaign | undefined;
}

export function getCampaignTasks(campaignId: string): DbCampaignTask[] {
  return getDb()
    .prepare('SELECT * FROM campaign_tasks WHERE campaign_id = ? ORDER BY position')
    .all(campaignId) as DbCampaignTask[];
}

export function updateCampaignTaskStatus(
  taskId: string,
  status: DbCampaignTask['status'],
  executionId?: string
): void {
  const now = Math.floor(Date.now() / 1000);
  const completed = status === 'done' || status === 'error' ? now : null;
  if (executionId) {
    getDb()
      .prepare('UPDATE campaign_tasks SET status = ?, execution_id = ?, completed_at = ? WHERE id = ?')
      .run(status, executionId, completed, taskId);
  } else {
    getDb()
      .prepare('UPDATE campaign_tasks SET status = ?, completed_at = ? WHERE id = ?')
      .run(status, completed, taskId);
  }
}

export function maybeCompleteCampaign(campaignId: string): DbCampaign['status'] {
  const tasks = getCampaignTasks(campaignId);
  const allDone = tasks.every(t => t.status === 'done');
  const anyError = tasks.some(t => t.status === 'error');
  const anyRunning = tasks.some(t => t.status === 'running');
  let newStatus: DbCampaign['status'] | null = null;
  if (allDone) newStatus = 'done';
  else if (anyError && !anyRunning) newStatus = 'error';
  if (newStatus) {
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare('UPDATE campaigns SET status = ?, completed_at = ? WHERE id = ?')
      .run(newStatus, now, campaignId);
  }
  const campaign = getCampaignById(campaignId)!;
  return campaign.status;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && npm test -- --reporter=verbose tests/campaigns.test.ts
```
Expected: PASS — both table tests green

- [ ] **Step 5: Commit**

```bash
git add server/src/db/index.ts server/tests/campaigns.test.ts
git commit -m "feat: add campaigns + campaign_tasks DB tables and helpers"
```

---

## Task 2: Backend routes — /campaigns

**Files:**
- Create: `server/src/routes/campaigns.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Add route tests to campaigns.test.ts**

Append to `server/tests/campaigns.test.ts`:

```ts
describe('campaigns routes', () => {
  let campaignId: string;

  it('POST /campaigns creates a campaign with tasks', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        project_id: projectId,
        title: 'Auth refactor',
        tasks: [
          { title: 'Analyze codebase', agent: 'claude_code' },
          { title: 'Write middleware', agent: 'claude_code' },
          { title: 'Update tests', agent: 'codex' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.campaign_id).toBeTruthy();
    expect(res.body.project_id).toBe(projectId);
    expect(res.body.tasks).toHaveLength(3);
    expect(res.body.tasks[0].status).toBe('waiting');
    campaignId = res.body.campaign_id;
  });

  it('GET /projects/:id/campaigns lists campaigns for project', async () => {
    const res = await request(app)
      .get(`/projects/${projectId}/campaigns`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('Auth refactor');
    expect(res.body[0].status).toBe('running');
  });

  it('GET /campaigns/:id returns campaign with tasks', async () => {
    const res = await request(app)
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.campaign.id).toBe(campaignId);
    expect(res.body.tasks).toHaveLength(3);
    expect(res.body.tasks[0].agent).toBe('claude_code');
  });

  it('GET /campaigns/:id returns 404 for unknown campaign', async () => {
    const res = await request(app)
      .get('/campaigns/nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('GET /projects/:id/campaigns requires auth', async () => {
    const res = await request(app).get(`/projects/${projectId}/campaigns`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && npm test -- --reporter=verbose tests/campaigns.test.ts
```
Expected: FAIL — "Not Found" on POST /campaigns

- [ ] **Step 3: Create server/src/routes/campaigns.ts**

```ts
import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  createCampaign,
  getCampaignsForProject,
  getCampaignById,
  getCampaignTasks,
  getProjectForUser,
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
    project_id, session_id ?? null, title, tasks
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
```

- [ ] **Step 4: Add campaigns list route to projects.ts**

In `server/src/routes/projects.ts`, add before `export default router;`:

```ts
import {
  getCampaignsForProject,
} from '../db/index.js';

router.get('/:id/campaigns', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const project = getDb()
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);
  if (!project) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(getCampaignsForProject(req.params.id));
});
```

(Add `getCampaignsForProject` to the existing `import { getDb, ... } from '../db/index.js'` import line — don't duplicate the import statement.)

- [ ] **Step 5: Register /campaigns route in server/src/index.ts**

Add to imports:
```ts
import campaignsRoutes from './routes/campaigns.js';
```

Add after the other `app.use(...)` calls:
```ts
app.use('/campaigns', campaignsRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd server && npm test -- --reporter=verbose tests/campaigns.test.ts
```
Expected: all 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/campaigns.ts server/src/routes/projects.ts server/src/index.ts server/tests/campaigns.test.ts
git commit -m "feat: add campaign API routes — POST /campaigns, GET /projects/:id/campaigns, GET /campaigns/:id"
```

---

## Task 3: create_campaign agent tool + task status threading

**Files:**
- Create: `server/src/tools/create_campaign.ts`
- Modify: `server/src/tools/definitions.ts`
- Modify: `server/src/services/agent.ts`

- [ ] **Step 1: Create server/src/tools/create_campaign.ts**

```ts
import { createCampaign, type DbCampaignTask } from '../db/index.js';

interface CreateCampaignInput {
  project_id: string;
  title: string;
  tasks: Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' }>;
  session_id?: string;
}

export function runCreateCampaign(
  input: CreateCampaignInput,
  userId: string
): string {
  const { campaign, tasks } = createCampaign(
    input.project_id,
    input.session_id ?? null,
    input.title,
    input.tasks
  );
  return JSON.stringify({
    campaign_id: campaign.id,
    project_id: campaign.project_id,
    tasks: tasks.map((t: DbCampaignTask) => ({ id: t.id, title: t.title, agent: t.agent })),
  });
}
```

- [ ] **Step 2: Add create_campaign tool definition to definitions.ts**

In `server/src/tools/definitions.ts`, add to the `toolDefinitions` array (before the closing `]`):

```ts
  {
    name: 'create_campaign',
    description: 'Create a campaign to track a coordinated multi-task delegation across Claude Code, Codex, or MCP tools. Call this BEFORE dispatching the individual tasks. The response includes task IDs — pass each task\'s id as campaign_task_id when calling invoke_claude_code, invoke_codex, or mcp_call so the tasks are linked and their status tracked.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project this campaign belongs to' },
        title: { type: 'string', description: 'Short name for the campaign, e.g. "Auth refactor"' },
        tasks: {
          type: 'array',
          description: 'Ordered list of planned tasks',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              agent: { type: 'string', enum: ['claude_code', 'codex', 'mcp'] },
            },
            required: ['title', 'agent'],
          },
        },
      },
      required: ['project_id', 'title', 'tasks'],
    },
  },
```

Also add the optional `campaign_task_id` property to `invoke_claude_code`, `invoke_codex`, and `mcp_call` input schemas. For each, add inside `properties`:

```ts
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
```

- [ ] **Step 3: Add create_campaign case + task status threading to agent.ts**

At the top of `server/src/services/agent.ts`, add to imports:
```ts
import { updateCampaignTaskStatus, maybeCompleteCampaign } from '../db/index.js';
import { runCreateCampaign } from '../tools/create_campaign.js';
```

In `dispatchTool`, add the `create_campaign` case in the `switch` block (after `delete_project`):

```ts
      case 'create_campaign': {
        result = runCreateCampaign(
          {
            project_id: toolInput.project_id as string,
            title: toolInput.title as string,
            tasks: toolInput.tasks as Array<{ title: string; agent: 'claude_code' | 'codex' | 'mcp' }>,
            session_id: sessionId,
          },
          userId
        );
        break;
      }
```

In the `invoke_claude_code` case, add campaign task status updates. Find the existing `case 'invoke_claude_code':` block and add these two lines:
- Just before `const ccResult = await invokeClaudeCode(...)`, add:
```ts
        const ccTaskId = toolInput.campaign_task_id as string | undefined;
        if (ccTaskId) { updateCampaignTaskStatus(ccTaskId, 'running', executionId); broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: 'running' }); }
```
- Just after `result = ccResult.result;`, add:
```ts
        if (ccTaskId) { const s = result.startsWith('Error') ? 'error' : 'done'; updateCampaignTaskStatus(ccTaskId, s, executionId); const parsed = JSON.parse(result.length < 2000 ? '{}' : '{}'); void parsed; const ct = getDb().prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?').get(ccTaskId) as { campaign_id: string } | undefined; if (ct) { maybeCompleteCampaign(ct.campaign_id); } broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: s }); }
```

Wait, that's too compressed and error-prone. Let me write it properly.

For the `invoke_claude_code` case, replace the existing block with:

```ts
      case 'invoke_claude_code': {
        if (!project) {
          result = `Error: project ${projectId} not found`;
          break;
        }
        if (!project.repo_path) {
          result = `Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(project.enabled_connection_ids ?? '[]');
        let ccApiKey: string | null = null;
        try { ccApiKey = getAnthropicKey(userId); } catch { /* use CLI's local auth */ }
        if (connectionIds.length > 0) {
          const anthropicConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'anthropic' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (anthropicConn) ccApiKey = getDecryptedConfig(anthropicConn.id).apiKey;
        }
        const ccWorktree = await ensureWorktree(project, sessionId);
        const ccTaskId = toolInput.campaign_task_id as string | undefined;
        if (ccTaskId) {
          updateCampaignTaskStatus(ccTaskId, 'running', executionId);
          broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: 'running' });
        }
        const ccResult = await invokeClaudeCode(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: ccWorktree.worktree_path, apiKey: ccApiKey, resumeSessionId: ccWorktree.claude_session_id, mcpServers: getMcpServersForUser(userId) }
        );
        if (ccResult.sessionId) setAgentWorktreeSession(ccWorktree.id, 'claude', ccResult.sessionId);
        result = ccResult.result;
        if (ccTaskId) {
          const taskFinalStatus = result.startsWith('Error') ? 'error' : 'done';
          updateCampaignTaskStatus(ccTaskId, taskFinalStatus, executionId);
          const taskRow = getDb()
            .prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?')
            .get(ccTaskId) as { campaign_id: string } | undefined;
          if (taskRow) maybeCompleteCampaign(taskRow.campaign_id);
          broadcast(userId, { type: 'campaign_task_updated', taskId: ccTaskId, status: taskFinalStatus });
        }
        break;
      }
```

Do the same for `invoke_codex` — add `ccTaskId` → `codexTaskId`, identical pattern:

```ts
      case 'invoke_codex': {
        if (!project) {
          result = `Error: project ${projectId} not found`;
          break;
        }
        if (!project.repo_path) {
          result = `Project '${project.name}' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.`;
          break;
        }
        const connectionIds: string[] = JSON.parse(project.enabled_connection_ids ?? '[]');
        let codexApiKey: string | null = null;
        if (connectionIds.length > 0) {
          const openaiConn = getDb()
            .prepare(`SELECT id FROM connections WHERE id IN (${connectionIds.map(() => '?').join(',')}) AND type = 'openai' LIMIT 1`)
            .get(...connectionIds) as { id: string } | undefined;
          if (openaiConn) codexApiKey = getDecryptedConfig(openaiConn.id).apiKey;
        }
        const codexWorktree = await ensureWorktree(project, sessionId);
        const codexTaskId = toolInput.campaign_task_id as string | undefined;
        if (codexTaskId) {
          updateCampaignTaskStatus(codexTaskId, 'running', executionId);
          broadcast(userId, { type: 'campaign_task_updated', taskId: codexTaskId, status: 'running' });
        }
        const codexResult = await invokeCodex(
          { prompt: toolInput.prompt as string },
          { userId, executionId, repoPath: codexWorktree.worktree_path, apiKey: codexApiKey, resumeSessionId: codexWorktree.codex_session_id, mcpServers: getMcpServersForUser(userId) }
        );
        if (codexResult.sessionId) setAgentWorktreeSession(codexWorktree.id, 'codex', codexResult.sessionId);
        result = codexResult.result;
        if (codexTaskId) {
          const taskFinalStatus = result.startsWith('Error') ? 'error' : 'done';
          updateCampaignTaskStatus(codexTaskId, taskFinalStatus, executionId);
          const taskRow = getDb()
            .prepare('SELECT campaign_id FROM campaign_tasks WHERE id = ?')
            .get(codexTaskId) as { campaign_id: string } | undefined;
          if (taskRow) maybeCompleteCampaign(taskRow.campaign_id);
          broadcast(userId, { type: 'campaign_task_updated', taskId: codexTaskId, status: taskFinalStatus });
        }
        break;
      }
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

```bash
cd server && npm test
```
Expected: all existing tests still PASS; create_campaign not yet tested here (that's in campaigns.test.ts)

- [ ] **Step 5: Commit**

```bash
git add server/src/tools/create_campaign.ts server/src/tools/definitions.ts server/src/services/agent.ts
git commit -m "feat: add create_campaign tool and thread campaign_task_id through invoke_claude_code/codex"
```

---

## Task 4: Frontend types + API functions

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Add Campaign, CampaignTask, WSCampaignTaskUpdated to types.ts**

Add to the end of `web/src/types.ts`:

```ts
export interface CampaignTask {
  id: string;
  campaign_id: string;
  title: string;
  agent: 'claude_code' | 'codex' | 'mcp';
  status: 'waiting' | 'running' | 'done' | 'error';
  execution_id: string | null;
  position: number;
  created_at: number;
  completed_at: number | null;
}

export interface Campaign {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}

export interface WSCampaignTaskUpdated extends WSEvent {
  type: 'campaign_task_updated';
  taskId: string;
  status: CampaignTask['status'];
}
```

- [ ] **Step 2: Add API functions to api.ts**

Add to the end of `web/src/lib/api.ts` (after the existing exports):

```ts
export function getProjectCampaigns(projectId: string): Promise<Campaign[]> {
  return request(`/projects/${projectId}/campaigns`);
}

export function getCampaign(campaignId: string): Promise<{ campaign: Campaign; tasks: CampaignTask[] }> {
  return request(`/campaigns/${campaignId}`);
}
```

Add the import for `Campaign` and `CampaignTask` to the import line at the top of `api.ts`:
```ts
import type { Session, Message, Project, Connection, EffortLevel, ClaudeModelInfo, UserSettings, Memory, ScheduledTask, SessionWorktree, Campaign, CampaignTask } from '../types.js';
```

- [ ] **Step 3: Commit**

```bash
git add web/src/types.ts web/src/lib/api.ts
git commit -m "feat: add Campaign/CampaignTask types and API functions"
```

---

## Task 5: CampaignCard component

**Files:**
- Create: `web/src/components/CampaignCard.tsx`

- [ ] **Step 1: Create web/src/components/CampaignCard.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import type { CampaignTask, WSCampaignTaskUpdated } from '../types.js';

interface CampaignCardProps {
  campaignId: string;
  projectId: string;
}

const STATUS_DOT: Record<CampaignTask['status'], string> = {
  waiting: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
};

const AGENT_LABEL: Record<CampaignTask['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
};

export default function CampaignCard({ campaignId, projectId }: CampaignCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => getCampaign(campaignId),
    staleTime: 60_000,
  });

  const [taskStatuses, setTaskStatuses] = useState<Record<string, CampaignTask['status']>>({});

  useEffect(() => {
    if (data) {
      const initial: Record<string, CampaignTask['status']> = {};
      data.tasks.forEach(t => { initial[t.id] = t.status; });
      setTaskStatuses(initial);
    }
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'campaign_task_updated') {
        const e = event as WSCampaignTaskUpdated;
        setTaskStatuses(prev => ({ ...prev, [e.taskId]: e.status }));
      }
    });
  }, []);

  if (isLoading || !data) {
    return (
      <div className="mt-2 w-64 rounded-xl border border-border/50 bg-background/60 p-3 text-xs text-muted-foreground animate-pulse">
        Loading campaign…
      </div>
    );
  }

  const { campaign, tasks } = data;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
  const isRunning = effectiveStatuses.some(s => s === 'running') || campaign.status === 'running';
  const isDone = campaign.status === 'done';
  const isError = campaign.status === 'error';

  return (
    <div className="mt-2 w-64 overflow-hidden rounded-xl border border-border/50 bg-background/80 shadow-sm">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-2">
        <span className="text-xs font-semibold text-foreground truncate pr-2">{campaign.title}</span>
        <span className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
          isRunning && 'bg-blue-100 text-blue-700',
          isDone && 'bg-green-100 text-green-700',
          isError && 'bg-red-100 text-red-700',
          !isRunning && !isDone && !isError && 'bg-muted text-muted-foreground',
        )}>
          {campaign.status}
        </span>
      </div>
      {/* tasks */}
      <div className="flex flex-col gap-1.5 px-3 py-2.5">
        {tasks.map(task => {
          const status = taskStatuses[task.id] ?? task.status;
          return (
            <div key={task.id} className="flex items-center gap-2">
              <div className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
              <span className="flex-1 truncate text-xs text-foreground/80">{task.title}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{AGENT_LABEL[task.agent]}</span>
            </div>
          );
        })}
      </div>
      {/* link */}
      <div className="border-t border-border/40 px-3 py-2">
        <Link
          to={`/projects/${projectId}/campaigns/${campaignId}`}
          className="block text-center text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
        >
          View campaign →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/CampaignCard.tsx
git commit -m "feat: add CampaignCard component with live WebSocket task status updates"
```

---

## Task 6: MessageList — render CampaignCard for create_campaign executions

**Files:**
- Modify: `web/src/components/MessageList.tsx`

- [ ] **Step 1: Update MessageList.tsx**

Add import at the top:
```tsx
import CampaignCard from './CampaignCard.js';
```

In the `executions[msg.id]` map, replace:
```tsx
                {(executions[msg.id] ?? []).map(exec => (
                  <ExecutionCard key={exec.executionId} {...exec} />
                ))}
```

With:
```tsx
                {(executions[msg.id] ?? []).map(exec => {
                  if (exec.tool === 'create_campaign' && exec.status === 'done' && exec.result) {
                    try {
                      const parsed = JSON.parse(exec.result) as { campaign_id: string; project_id: string };
                      if (parsed.campaign_id && parsed.project_id) {
                        return (
                          <CampaignCard
                            key={exec.executionId}
                            campaignId={parsed.campaign_id}
                            projectId={parsed.project_id}
                          />
                        );
                      }
                    } catch { /* fall through to ExecutionCard */ }
                  }
                  return <ExecutionCard key={exec.executionId} {...exec} />;
                })}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/MessageList.tsx
git commit -m "feat: render CampaignCard in chat for create_campaign executions"
```

---

## Task 7: ExecutionCard — color-coded left border

**Files:**
- Modify: `web/src/components/ExecutionCard.tsx`

- [ ] **Step 1: Read the full ExecutionCard file to find the Card element**

Run: `cat web/src/components/ExecutionCard.tsx` and locate the `<Card` JSX element that wraps the card.

- [ ] **Step 2: Add border-l-2 color classes to the Card**

Find the `<Card` element (it will look like `<Card className="...">`) and add color-coded left border classes. The existing `className` on the Card likely contains layout classes. Add to it:

```tsx
const BORDER_COLOR: Record<ExecutionStatus, string> = {
  pending: 'border-l-muted-foreground/20',
  running: 'border-l-blue-400',
  done: 'border-l-green-400',
  error: 'border-l-destructive',
  awaiting_approval: 'border-l-amber-400',
};
```

Add this constant near the top of the component (after `STATUS_LABEL`), then on the `<Card` element add `border-l-2 ${BORDER_COLOR[status]}` to the className. Use `cn()` to compose:

```tsx
<Card className={cn('overflow-hidden text-sm', 'border-l-2', BORDER_COLOR[status])}>
```

(Preserve whatever classes were there — just add `border-l-2` and `BORDER_COLOR[status]`.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ExecutionCard.tsx
git commit -m "feat: add color-coded left border to ExecutionCard by status"
```

---

## Task 8: Chat header redesign + MessageInput cleanup

**Files:**
- Modify: `web/src/components/ChatView.tsx`
- Modify: `web/src/components/MessageInput.tsx`

- [ ] **Step 1: Update MessageInput.tsx — remove effort/model selectors**

Replace the entire `MessageInput` component with a simpler version. The new component accepts only `onSend` and `disabled`:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [value, setValue] = useState('');

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div className="shrink-0 px-6 pb-5 pt-3">
      <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-3xl border border-border/65 bg-background/82 p-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/75">
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={disabled}
          rows={1}
          className={cn(
            'min-h-12 flex-1 resize-none border-0 bg-transparent px-3 py-3 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent',
            disabled && 'text-muted-foreground',
          )}
        />
        <div className="mb-1">
          <Button
            size="icon-lg"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
            className={cn(
              'rounded-2xl bg-foreground text-background hover:bg-foreground/90',
              (disabled || !value.trim()) && 'bg-muted text-muted-foreground hover:bg-muted',
            )}
          >
            <ArrowUp size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ChatView.tsx header and MessageInput usage**

In `ChatView.tsx`, find the header section. Currently it renders minimal text ("Chat"). Replace the header with a redesigned one that shows title, pinned project, effort/model chips.

Find the header JSX (search for `<header` or the element rendering "Chat") and replace it with:

```tsx
{/* Chat header */}
<header className="flex h-14 shrink-0 items-center justify-between border-b border-border/40 px-5">
  <div className="flex min-w-0 flex-col">
    <span className="truncate text-sm font-semibold text-foreground">
      {chat?.title ?? 'Untitled chat'}
    </span>
    {pinnedProject && (
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="text-xs text-muted-foreground truncate">{pinnedProject.name}</span>
      </div>
    )}
  </div>
  <div className="flex shrink-0 items-center gap-2">
    <Select value={effort} onValueChange={value => configMutation.mutate({ effort: value as EffortLevel })}>
      <SelectTrigger size="sm" className="h-7 w-24 rounded-lg border-border/50 bg-muted/50 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(['low', 'medium', 'high'] as EffortLevel[]).map(o => (
          <SelectItem key={o} value={o}>{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Select
      value={chat?.model ?? 'auto'}
      onValueChange={value => configMutation.mutate({ model: value === 'auto' ? null : value })}
    >
      <SelectTrigger size="sm" className="h-7 w-32 rounded-lg border-border/50 bg-muted/50 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto</SelectItem>
        {models.map(m => (
          <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</header>
```

Make sure `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` are imported from `@/components/ui/select`. They should already be in ChatView if the file previously had model/effort selectors.

Find the `<MessageInput` usage in ChatView and remove the `effort`, `onEffortChange`, `model`, `onModelChange`, `models` props — the new interface only accepts `onSend` and `disabled`:

```tsx
<MessageInput
  onSend={handleSend}
  disabled={sendMutation.isPending}
/>
```

Remove any now-unused state/variables related to passing effort/model to MessageInput (they are still used by the new header selectors, so keep them if configMutation uses them).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/ChatView.tsx web/src/components/MessageInput.tsx
git commit -m "feat: redesign chat header with title + project + effort/model chips; clean up input bar"
```

---

## Task 9: ProjectsPage — full-width card grid

**Files:**
- Modify: `web/src/pages/ProjectsPage.tsx`

- [ ] **Step 1: Rewrite ProjectsPage.tsx**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderGit2, FileText } from 'lucide-react';
import { getProjects, createProject, getProjectCampaigns } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Project } from '../types.js';

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const { data: campaigns = [] } = useQuery({
    queryKey: ['project-campaigns', project.id],
    queryFn: () => getProjectCampaigns(project.id),
    staleTime: 30_000,
  });
  const runningCount = campaigns.filter(c => c.status === 'running').length;

  return (
    <button
      onClick={() => navigate(`/projects/${project.id}`)}
      className="group flex flex-col gap-3 rounded-2xl border border-border/50 bg-background/60 p-5 text-left shadow-sm transition-all hover:border-border hover:bg-background/90 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {project.repo_path
            ? <FolderGit2 size={16} className="shrink-0 text-muted-foreground" />
            : <FileText size={16} className="shrink-0 text-muted-foreground" />
          }
          <span className="font-semibold text-sm text-foreground">{project.name}</span>
        </div>
        {runningCount > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] text-blue-600 font-medium">{runningCount} running</span>
          </div>
        )}
      </div>
      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{project.description}</p>
      )}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
        <span>{project.repo_path ? 'code repo' : 'doc project'}</span>
        {campaigns.length > 0 && (
          <span>{campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </button>
  );
}

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoPath, setRepoPath] = useState('');

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: getProjects,
  });

  const createMutation = useMutation({
    mutationFn: () => createProject({
      name: name.trim(),
      description: description.trim() || undefined,
      repo_path: repoPath.trim() || undefined,
      enabled_connection_ids: [],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setName(''); setDescription(''); setRepoPath('');
    },
  });

  if (isLoading) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between px-6 border-b border-border/40">
        <h1 className="text-sm font-semibold">Projects</h1>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <Plus size={13} />
          New project
        </Button>
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground/60">No projects yet.</p>
          <Button size="sm" onClick={() => setOpen(true)}>Create your first project</Button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl">
            {projects.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input
              placeholder="Project name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <Input
              placeholder="Repo path (optional, e.g. /Users/me/code/my-app)"
              value={repoPath}
              onChange={e => setRepoPath(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/ProjectsPage.tsx
git commit -m "feat: rewrite ProjectsPage as full-width card grid with campaign count + running indicator"
```

---

## Task 10: ProjectPage — tabbed workspace (/projects/:id)

**Files:**
- Create: `web/src/pages/ProjectPage.tsx`

- [ ] **Step 1: Create web/src/pages/ProjectPage.tsx**

```tsx
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderGit2, FileText, GitBranch } from 'lucide-react';
import { getProjects, getProjectCampaigns, createChat, updateChatConfig, deleteProject } from '../lib/api.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import FileBrowser from '../components/FileBrowser.js';
import { timeAgo } from '../lib/utils.js';
import type { Project, Campaign } from '../types.js';

type Tab = 'overview' | 'campaigns' | 'files' | 'settings';

const STATUS_COLORS: Record<Campaign['status'], string> = {
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: async () => {
      const { getProjects } = await import('../lib/api.js');
      return getProjects();
    },
    staleTime: 30_000,
  });
  const project = projects.find(p => p.id === projectId) ?? null;

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ['project-campaigns', projectId],
    queryFn: () => getProjectCampaigns(projectId!),
    enabled: !!projectId,
    staleTime: 20_000,
  });

  const startChatMutation = useMutation({
    mutationFn: async () => {
      const { id } = await createChat();
      await updateChatConfig(id, { pinned_project_id: projectId ?? null });
      return id;
    },
    onSuccess: (id) => navigate(`/c/${id}`),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  if (!project) return null;

  const runningCampaigns = campaigns.filter(c => c.status === 'running');
  const recentCampaign = campaigns[0] ?? null;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'campaigns', label: `Campaigns${campaigns.length > 0 ? ` (${campaigns.length})` : ''}` },
    { id: 'files', label: 'Files' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/40 bg-background/60 px-6 pt-4 pb-0">
        <div className="flex items-center gap-2 mb-3">
          <button onClick={() => navigate('/projects')} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={15} />
          </button>
          <span className="text-xs text-muted-foreground">Projects</span>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-foreground font-medium">{project.name}</span>
        </div>
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              {project.repo_path
                ? <FolderGit2 size={15} className="text-muted-foreground" />
                : <FileText size={15} className="text-muted-foreground" />
              }
              <h1 className="text-base font-semibold">{project.name}</h1>
              <span className="text-xs text-muted-foreground/50 bg-muted/50 rounded px-1.5 py-0.5">
                {project.repo_path ? 'code repo' : 'doc project'}
              </span>
            </div>
            {project.description && (
              <p className="mt-0.5 text-xs text-muted-foreground ml-[23px]">{project.description}</p>
            )}
          </div>
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => startChatMutation.mutate()}
            disabled={startChatMutation.isPending}
          >
            Start chat
          </Button>
        </div>
        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2 text-xs font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="p-6 max-w-3xl">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground mb-1">Campaigns</div>
                <div className="text-2xl font-semibold">{campaigns.length}</div>
                {runningCampaigns.length > 0 && (
                  <div className="text-xs text-blue-600 font-medium mt-0.5">{runningCampaigns.length} running</div>
                )}
              </div>
              <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                <div className="text-xs text-muted-foreground mb-1">MCP tools</div>
                <div className="text-2xl font-semibold">
                  {JSON.parse(project.enabled_connection_ids as unknown as string ?? '[]').length}
                </div>
              </div>
              {project.repo_path && (
                <div className="rounded-xl border border-border/50 bg-background/60 p-4">
                  <div className="text-xs text-muted-foreground mb-1">Repo</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <GitBranch size={12} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground truncate">{project.repo_path.split('/').pop()}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Recent campaign */}
            {recentCampaign && (
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Recent campaign</div>
                <Link
                  to={`/projects/${projectId}/campaigns/${recentCampaign.id}`}
                  className="block rounded-xl border border-border/50 bg-background/60 p-4 hover:border-border hover:bg-background/90 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{recentCampaign.title}</span>
                    <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', STATUS_COLORS[recentCampaign.status])}>
                      {recentCampaign.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Started {timeAgo(recentCampaign.created_at)}
                  </div>
                </Link>
              </div>
            )}
            {campaigns.length === 0 && (
              <p className="text-sm text-muted-foreground/60">No campaigns yet. Start a chat to kick one off.</p>
            )}
          </div>
        )}

        {tab === 'campaigns' && (
          <div className="p-6 max-w-3xl">
            {campaigns.length === 0 ? (
              <p className="text-sm text-muted-foreground/60">No campaigns yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {campaigns.map(c => (
                  <Link
                    key={c.id}
                    to={`/projects/${projectId}/campaigns/${c.id}`}
                    className="flex items-center justify-between rounded-xl border border-border/50 bg-background/60 px-4 py-3 hover:border-border hover:bg-background/90 transition-all"
                  >
                    <div>
                      <div className="text-sm font-medium">{c.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{timeAgo(c.created_at)}</div>
                    </div>
                    <span className={cn('text-[10px] font-medium rounded-full px-2 py-0.5', STATUS_COLORS[c.status])}>
                      {c.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'files' && (
          <div className="p-6">
            <FileBrowser projectId={projectId!} />
          </div>
        )}

        {tab === 'settings' && (
          <div className="p-6 max-w-lg">
            <ProjectSettingsForm project={project} onDelete={() => deleteMutation.mutate()} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectSettingsForm({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [repoPath, setRepoPath] = useState(project.repo_path ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => {
      const { updateProject } = require('../lib/api.js');
      return updateProject({ project_id: project.id, description: description.trim() });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} disabled />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Description</label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
          />
        </div>
        {project.repo_path && (
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Repo path</label>
            <Input value={repoPath} disabled className="font-mono text-xs" />
          </div>
        )}
        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="w-fit"
        >
          Save changes
        </Button>
      </div>
      <div className="border-t border-border/40 pt-5">
        <div className="text-xs font-medium text-muted-foreground mb-2">Danger zone</div>
        {!confirmDelete ? (
          <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(true)}>
            Delete project
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="destructive" onClick={onDelete}>Confirm delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: The `require` in `ProjectSettingsForm` is a workaround to avoid circular import — replace it with a proper import at the top of the file. Add `updateProject` to the existing named imports from `'../lib/api.js'`.

- [ ] **Step 2: Fix the updateProject import**

Make sure `updateProject` is exported from `api.ts`. Add if missing:

```ts
export function updateProject(body: { project_id: string; description: string }): Promise<void> {
  return request(`/projects/${body.project_id}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: body.description }),
  });
}
```

Also add a PATCH route to `server/src/routes/projects.ts`:

```ts
router.patch('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const { description } = req.body as { description?: string };
  const result = getDb()
    .prepare('UPDATE projects SET description = ? WHERE id = ? AND user_id = ?')
    .run(description ?? null, req.params.id, userId);
  if (result.changes === 0) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ok: true });
});
```

Remove the `require` from `ProjectSettingsForm` and add `updateProject` to the import at the top of `ProjectPage.tsx`:

```ts
import { getProjects, getProjectCampaigns, createChat, updateChatConfig, deleteProject, updateProject } from '../lib/api.js';
```

Then fix `ProjectSettingsForm` to call `updateProject` directly:

```ts
mutationFn: () => updateProject({ project_id: project.id, description: description.trim() }),
```

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ProjectPage.tsx web/src/lib/api.ts server/src/routes/projects.ts
git commit -m "feat: add ProjectPage with tabs (Overview/Campaigns/Files/Settings)"
```

---

## Task 11: CampaignPage — campaign detail (/projects/:id/campaigns/:cid)

**Files:**
- Create: `web/src/pages/CampaignPage.tsx`

- [ ] **Step 1: Create web/src/pages/CampaignPage.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { getCampaign } from '../lib/api.js';
import { subscribe } from '../lib/ws.js';
import { cn } from '@/lib/utils';
import { timeAgo } from '../lib/utils.js';
import type { CampaignTask, WSCampaignTaskUpdated } from '../types.js';

const STATUS_DOT: Record<CampaignTask['status'], string> = {
  waiting: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
  error: 'bg-destructive',
};

const STATUS_BORDER: Record<CampaignTask['status'], string> = {
  waiting: 'border-border/50',
  running: 'border-blue-200',
  done: 'border-green-200',
  error: 'border-red-200',
};

const STATUS_BG: Record<CampaignTask['status'], string> = {
  waiting: 'bg-background/60',
  running: 'bg-blue-50/60',
  done: 'bg-green-50/40',
  error: 'bg-red-50/40',
};

const AGENT_LABEL: Record<CampaignTask['agent'], string> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
  mcp: 'MCP',
};

const CAMPAIGN_STATUS_COLORS = {
  running: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  cancelled: 'bg-muted text-muted-foreground',
};

export default function CampaignPage() {
  const { projectId, campaignId } = useParams<{ projectId: string; campaignId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => getCampaign(campaignId!),
    enabled: !!campaignId,
    refetchInterval: (query) => {
      return query.state.data?.campaign.status === 'running' ? 10_000 : false;
    },
  });

  const [taskStatuses, setTaskStatuses] = useState<Record<string, CampaignTask['status']>>({});

  useEffect(() => {
    if (data) {
      const initial: Record<string, CampaignTask['status']> = {};
      data.tasks.forEach(t => { initial[t.id] = t.status; });
      setTaskStatuses(initial);
    }
  }, [data]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'campaign_task_updated') {
        const e = event as WSCampaignTaskUpdated;
        setTaskStatuses(prev => ({ ...prev, [e.taskId]: e.status }));
      }
    });
  }, []);

  if (isLoading || !data) return null;

  const { campaign, tasks } = data;
  const effectiveStatuses = tasks.map(t => taskStatuses[t.id] ?? t.status);
  const doneCount = effectiveStatuses.filter(s => s === 'done').length;
  const progressPct = tasks.length > 0 ? (doneCount / tasks.length) * 100 : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/40 px-6 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Link to={`/projects/${projectId}`} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={15} />
          </Link>
          <Link to={`/projects/${projectId}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            {projectId}
          </Link>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-muted-foreground">Campaigns</span>
          <span className="text-xs text-muted-foreground/40">/</span>
          <span className="text-xs text-foreground font-medium truncate max-w-xs">{campaign.title}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold">{campaign.title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Started {timeAgo(campaign.created_at)}
              {campaign.completed_at && ` · completed ${timeAgo(campaign.completed_at)}`}
            </p>
          </div>
          <span className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium',
            CAMPAIGN_STATUS_COLORS[campaign.status],
          )}>
            {campaign.status}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-border/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{doneCount} / {tasks.length}</span>
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-3 max-w-2xl">
          {tasks.map(task => {
            const status = taskStatuses[task.id] ?? task.status;
            return (
              <TaskRow key={task.id} task={task} status={status} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, status }: { task: CampaignTask; status: CampaignTask['status'] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'rounded-xl border transition-colors',
      STATUS_BORDER[status],
      STATUS_BG[status],
    )}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])} />
          <span className={cn('text-sm font-medium truncate', status === 'waiting' && 'text-muted-foreground')}>
            {task.title}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <span className="text-xs text-muted-foreground">{AGENT_LABEL[task.agent]}</span>
          <span className={cn(
            'text-xs font-medium',
            status === 'done' && 'text-green-600',
            status === 'running' && 'text-blue-600',
            status === 'error' && 'text-destructive',
            status === 'waiting' && 'text-muted-foreground/50',
          )}>
            {status}
          </span>
          {(status === 'done' || status === 'running' || status === 'error') && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? 'hide output' : 'view output'}
            </button>
          )}
        </div>
      </div>
      {expanded && task.execution_id && (
        <ExecutionOutput executionId={task.execution_id} />
      )}
    </div>
  );
}

function ExecutionOutput({ executionId }: { executionId: string }) {
  const { data } = useQuery({
    queryKey: ['execution-output', executionId],
    queryFn: async () => {
      const res = await fetch(`/executions/${executionId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return res.json() as Promise<{ output_log: string; result: string | null }>;
    },
    staleTime: 5_000,
  });

  return (
    <div className="border-t border-border/30 px-4 py-3">
      <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
        {data?.output_log || data?.result || 'No output yet'}
      </pre>
    </div>
  );
}
```

Note: `ExecutionOutput` fetches `/executions/:id` — add a GET route in `server/src/routes/executions.ts` if it doesn't exist:

```ts
router.get('/:id', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const execution = getDb()
    .prepare(`
      SELECT e.id, e.output_log, e.result, e.status
      FROM executions e
      JOIN messages m ON m.id = e.message_id
      JOIN sessions s ON s.id = m.session_id
      WHERE e.id = ? AND s.user_id = ?
    `)
    .get(req.params.id, userId);
  if (!execution) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(execution);
});
```

Also fix the import in `CampaignPage.tsx`: replace `localStorage.getItem('token')` with the proper `getToken()` from `'../lib/auth.js'`:

```tsx
import { getToken } from '../lib/auth.js';
// ...
headers: { Authorization: `Bearer ${getToken()}` },
```

- [ ] **Step 2: Commit**

```bash
git add web/src/pages/CampaignPage.tsx server/src/routes/executions.ts
git commit -m "feat: add CampaignPage with task list, live status updates, and expandable execution output"
```

---

## Task 12: Router updates

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/AppLayout.tsx`

- [ ] **Step 1: Add new routes to App.tsx**

Add imports:
```tsx
import ProjectPage from './pages/ProjectPage.js';
import CampaignPage from './pages/CampaignPage.js';
```

In the `children` array of the router, add after `{ path: 'projects', element: <ProjectsPage /> }`:
```tsx
{ path: 'projects/:projectId', element: <ProjectPage /> },
{ path: 'projects/:projectId/campaigns/:campaignId', element: <CampaignPage /> },
```

- [ ] **Step 2: Update AppLayout isPageRoute check**

In `web/src/pages/AppLayout.tsx`, change:
```tsx
const isPageRoute = PAGE_ROUTES.includes(location.pathname);
```
to:
```tsx
const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));
```

Also add `'/projects'` to `PAGE_ROUTES` if it's not already there (it should be).

- [ ] **Step 3: Run the dev server and do a full smoke-test**

```bash
cd /path/to/unnamedproject && npm run dev
```

Visit in browser:
1. `/` — redirects to `/c`, shows chat empty state ✓
2. `/projects` — shows card grid (empty "No projects yet" state) ✓
3. Create a project via the dialog → project card appears ✓
4. Click project card → `/projects/:id` with Overview/Campaigns/Files/Settings tabs ✓
5. Click Files tab → FileBrowser renders ✓
6. Send a chat message and verify effort/model chips are in the header, not the input bar ✓
7. Verify ExecutionCards have colored left borders ✓

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/pages/AppLayout.tsx
git commit -m "feat: add /projects/:id and /projects/:id/campaigns/:cid routes; fix isPageRoute for nested paths"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Design system (color coding, surface hierarchy) — covered in ExecutionCard task + CampaignCard
- ✅ Nav/sidebar — no structural changes needed (sidebar already routes to /projects correctly)
- ✅ Projects list card grid — Task 9
- ✅ Project workspace tabs (Overview/Campaigns/Files/Settings) — Task 10
- ✅ Campaign DB model — Task 1
- ✅ create_campaign tool + campaign_task_id threading — Task 3
- ✅ Campaign API routes — Task 2
- ✅ Campaign card in chat — Tasks 5+6
- ✅ Campaign detail page — Task 11
- ✅ Chat header redesign — Task 8
- ✅ Input bar cleanup — Task 8
- ✅ Execution card color borders — Task 7
- ✅ WebSocket live updates — CampaignCard + CampaignPage subscribe to campaign_task_updated

**Type consistency check:**
- `DbCampaignTask.agent` uses `'claude_code' | 'codex' | 'mcp'` throughout
- `CampaignTask.status` uses `'waiting' | 'running' | 'done' | 'error'` throughout
- `createCampaign()` returns `{ campaign: DbCampaign; tasks: DbCampaignTask[] }` — matches usage in `runCreateCampaign`
- `getCampaign()` API returns `{ campaign: Campaign; tasks: CampaignTask[] }` — matches CampaignPage and CampaignCard usage
- `updateCampaignTaskStatus(taskId, status, executionId?)` — called with 3 args in agent.ts, signature accepts optional 3rd ✓

**One gap:** `ProjectPage` uses `project.enabled_connection_ids` as a string to parse JSON — but `api.ts` already parses it to `string[]` in the projects GET response. Fix in Task 10: remove the `JSON.parse` and use `project.enabled_connection_ids.length` directly (it's already `string[]` from the API).
