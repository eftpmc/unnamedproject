import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../src/db/index.js';
import { createTrigger, listTriggers, setTriggerEnabled, markTriggerRun, deleteTrigger } from '../src/services/triggers.js';

const SPACE = 'space-trig';
beforeAll(() => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u3','trig@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u3', 'Trig');
});

describe('triggers service', () => {
  it('creates and lists triggers', () => {
    const t = createTrigger({ space_id: SPACE, kind: 'schedule', schedule_cron: '0 8 * * *', next_run_at: 1000 });
    expect(t.kind).toBe('schedule');
    expect(listTriggers(SPACE).map(x => x.id)).toContain(t.id);
  });

  it('toggles enabled and records a run', () => {
    const [t] = listTriggers(SPACE);
    expect(setTriggerEnabled(t.id, false)).toBe(true);
    markTriggerRun(t.id, 2000);
    const updated = listTriggers(SPACE).find(x => x.id === t.id)!;
    expect(updated.enabled).toBe(0);
    expect(updated.next_run_at).toBe(2000);
    expect(updated.last_run_at).not.toBeNull();
  });

  it('deletes a trigger', () => {
    const t = createTrigger({ space_id: SPACE, kind: 'manual' });
    expect(deleteTrigger(t.id)).toBe(true);
  });
});
