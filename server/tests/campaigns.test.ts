import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import { app } from '../src/index.js';
import { initDb, getDb, createCampaign, getCampaignsForProject, getCampaignById, getCampaignTasks, updateCampaignTaskStatus, maybeCompleteCampaign } from '../src/db/index.js';

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

describe('campaign helpers', () => {
  let campaignId: string;

  it('createCampaign creates campaign and tasks', () => {
    const { campaign, tasks } = createCampaign(projectId, null, 'Test campaign', [
      { title: 'Task A', agent: 'claude_code' },
      { title: 'Task B', agent: 'codex' },
    ]);
    expect(campaign.id).toBeTruthy();
    expect(campaign.status).toBe('running');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe('waiting');
    expect(tasks[0].agent).toBe('claude_code');
    expect(tasks[1].position).toBe(1);
    campaignId = campaign.id;
  });

  it('getCampaignsForProject returns campaigns', () => {
    const campaigns = getCampaignsForProject(projectId);
    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.some(c => c.id === campaignId)).toBe(true);
  });

  it('updateCampaignTaskStatus + maybeCompleteCampaign', () => {
    const tasks = getCampaignTasks(campaignId);
    updateCampaignTaskStatus(tasks[0].id, 'done');
    updateCampaignTaskStatus(tasks[1].id, 'done');
    const status = maybeCompleteCampaign(campaignId);
    expect(status).toBe('done');
    const campaign = getCampaignById(campaignId)!;
    expect(campaign.status).toBe('done');
    expect(campaign.completed_at).not.toBeNull();
  });
});

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
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((c: { title: string }) => c.title === 'Auth refactor')).toBe(true);
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

  it('POST /campaigns accepts file_write, git, and github steps', async () => {
    const res = await request(app)
      .post('/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        project_id: projectId,
        title: 'Mixed-step campaign',
        tasks: [
          { title: 'Implement feature', agent: 'claude_code' },
          { title: 'Write config file', agent: 'file_write' },
          { title: 'Commit changes', agent: 'git' },
          { title: 'Open pull request', agent: 'github' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.tasks.map((t: { agent: string }) => t.agent)).toEqual(['claude_code', 'file_write', 'git', 'github']);

    const get = await request(app)
      .get(`/campaigns/${res.body.campaign_id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.tasks).toHaveLength(4);

    // Walk all tasks to done and confirm the campaign auto-completes.
    for (const task of get.body.tasks as { id: string }[]) {
      updateCampaignTaskStatus(task.id, 'done');
    }
    const status = maybeCompleteCampaign(res.body.campaign_id);
    expect(status).toBe('done');
  });
});
