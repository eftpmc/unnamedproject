import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { createTrigger, listTriggersByProject, setTriggerEnabled, markTriggerRun, deleteTrigger } from '../src/services/triggers.js';
import { newId } from '../src/lib/ids.js';

let projectId: string;

beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  const userId = 'u3';
  projectId = newId();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES (?,?,?)").run(userId, 'trig@test.com', 'x');
  getDb().prepare("INSERT INTO projects (id,user_id,name,repo_path,files_path,default_branch,origin,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(projectId, userId, 'TrigProj', '/tmp/trig', '/tmp/trig-files', null, 'linked', Math.floor(Date.now() / 1000));
});

describe('triggers service', () => {
  it('creates and lists triggers', () => {
    const t = createTrigger({ project_id: projectId, kind: 'schedule', schedule_cron: '0 8 * * *', next_run_at: 1000 });
    expect(t.kind).toBe('schedule');
    expect(listTriggersByProject(projectId, 'u3').map(x => x.id)).toContain(t.id);
  });

  it('toggles enabled and records a run', () => {
    const [t] = listTriggersByProject(projectId, 'u3');
    expect(setTriggerEnabled(t.id, false)).toBe(true);
    markTriggerRun(t.id, 2000);
    const updated = listTriggersByProject(projectId, 'u3').find(x => x.id === t.id)!;
    expect(updated.enabled).toBe(0);
    expect(updated.next_run_at).toBe(2000);
    expect(updated.last_run_at).not.toBeNull();
  });

  it('deletes a trigger', () => {
    const t = createTrigger({ project_id: projectId, kind: 'manual' });
    expect(deleteTrigger(t.id)).toBe(true);
  });
});
