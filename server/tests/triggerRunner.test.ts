import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';

const { runAgentTurn } = vi.hoisted(() => ({ runAgentTurn: vi.fn(async () => {}) }));
vi.mock('../src/services/agent.js', () => ({ runAgentTurn }));

import { initDb, getDb } from '../src/db/index.js';
import { writeDocument } from '../src/services/documents.js';
import { createTrigger, listTriggers } from '../src/services/triggers.js';
import { fireTrigger } from '../src/services/triggerRunner.js';

const SPACE = 'space-runner';
beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
  getDb().prepare("INSERT INTO users (id,email,hashed_password) VALUES ('u','run@test','x')").run();
  getDb().prepare("INSERT INTO spaces (id,user_id,name) VALUES (?,?,?)").run(SPACE, 'u', 'S');
});

describe('fireTrigger', () => {
  it('seeds a session from the playbook and advances next_run_at', async () => {
    const playbook = await writeDocument({ space_id: SPACE, path: 'flow.md', title: 'Flow', frontmatter: { type: 'workflow' }, body: 'Search internships and draft applications.' });
    const t = createTrigger({ space_id: SPACE, kind: 'schedule', schedule_cron: '0 8 * * *', playbook_id: playbook.id, next_run_at: 1 });

    await fireTrigger(t.id);

    expect(runAgentTurn).toHaveBeenCalledOnce();
    const sessions = getDb().prepare('SELECT * FROM sessions WHERE pinned_space_id = ?').all(SPACE) as Array<{ id: string }>;
    expect(sessions.length).toBe(1);
    const msg = getDb().prepare('SELECT content FROM messages').get() as { content: string };
    expect(msg.content).toContain('Search internships');
    const updated = listTriggers(SPACE).find(x => x.id === t.id)!;
    expect(updated.next_run_at).toBeGreaterThan(1);
    expect(updated.last_run_at).not.toBeNull();
  });
});
