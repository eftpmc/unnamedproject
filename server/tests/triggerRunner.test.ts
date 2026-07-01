import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import { newId } from '../src/lib/ids.js';

const { runAgentTurn } = vi.hoisted(() => ({ runAgentTurn: vi.fn(async () => {}) }));
vi.mock('../src/services/agent.js', () => ({ runAgentTurn }));

import { initDb, getDb } from '../src/db/index.js';
import { writeFile } from '../src/services/files.js';
import { createTrigger, listTriggersByProject } from '../src/services/triggers.js';
import { fireTrigger } from '../src/services/triggerRunner.js';

let projectId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  projectId = newId();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','run@test.com','x')").run();
  getDb().prepare("INSERT INTO projects (id,user_id,name,repo_path,files_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(projectId, 'u', 'RunnerProj', '/tmp/runner', '/tmp/runner-files', null, 'linked', Math.floor(Date.now() / 1000));
});

describe('fireTrigger', () => {
  it('seeds a session from the playbook and advances next_run_at', async () => {
    const playbook = await writeFile({ project_id: projectId, path: 'flow.md', title: 'Flow', tags: { type: 'workflow' }, body: 'Search internships and draft applications.' });
    const t = createTrigger({ project_id: projectId, kind: 'schedule', schedule_cron: '0 8 * * *', playbook_id: playbook.id, next_run_at: 1 });

    await fireTrigger(t.id);

    expect(runAgentTurn).toHaveBeenCalledOnce();
    const sessions = getDb().prepare('SELECT * FROM sessions WHERE pinned_project_id = ?').all(projectId) as Array<{ id: string }>;
    expect(sessions.length).toBe(1);
    const msg = getDb().prepare('SELECT content FROM messages').get() as { content: string };
    expect(msg.content).toContain('Search internships');
    const updated = listTriggersByProject(projectId, 'u').find(x => x.id === t.id)!;
    expect(updated.next_run_at).toBeGreaterThan(1);
    expect(updated.last_run_at).not.toBeNull();
  });
});
