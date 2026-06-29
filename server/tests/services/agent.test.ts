import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initDb, getDb, closeDb } from '../../src/db/index.js';
import { newId } from '../../src/lib/ids.js';

const DATA_DIR = process.env.DATA_DIR!;

const mockInvoke = vi.fn().mockImplementation(async (params) => {
  params.onText('Hello from provider');
  params.onSessionId('prov-sess-1');
  return { costUsd: 0.001 };
});

vi.mock('../../src/services/conversation-provider.js', () => ({
  isProviderLimitError: (err: unknown) => String(err instanceof Error ? err.message : err).toLowerCase().includes('usage limit'),
  getConversationProvider: vi.fn().mockResolvedValue({
    type: 'codex',
    invoke: mockInvoke,
    resolveModel: vi.fn().mockResolvedValue('codex-mini-latest'),
  }),
}));
vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));
vi.mock('../../src/mcp/auth.js', () => ({ generateMcpToken: vi.fn().mockReturnValue('mcp-tok') }));

beforeAll(() => {
  closeDb();
  try { fs.unlinkSync(path.join(DATA_DIR, 'app.db')); } catch { /* ok */ }
  initDb(DATA_DIR);
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, hashed_password) VALUES ('u1','a@b.com','x')").run();
  db.prepare("INSERT INTO sessions (id, user_id) VALUES ('s1','u1')").run();
  db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m1','s1','user','hello')").run();
  db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t1','s1','m1','running')").run();
});

afterAll(() => closeDb());

describe('runAgentTurn', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (params) => {
      params.onText('Hello from provider');
      params.onSessionId('prov-sess-1');
      return { costUsd: 0.001, executionId: 'exec-1' };
    });
  });

  it('streams text delta and stores provider session id', async () => {
    const { broadcast } = await import('../../src/services/socket.js');
    const { runAgentTurn } = await import('../../src/services/agent.js');
    getDb()
      .prepare("INSERT INTO executions (id, message_id, tool, status) VALUES ('exec-1','m1','codex','running')")
      .run();

    await runAgentTurn('u1', 's1', 'm1');

    const broadcastCalls = (broadcast as ReturnType<typeof vi.fn>).mock.calls;
    const deltaCall = broadcastCalls.find(([, msg]: [string, { type: string }]) => msg.type === 'message_delta');
    expect(deltaCall).toBeDefined();
    expect(deltaCall[1].delta).toBe('Hello from provider');

    const session = getDb().prepare('SELECT provider_session_id FROM sessions WHERE id = ?').get('s1') as { provider_session_id: string | null };
    expect(session.provider_session_id).toBe('prov-sess-1');

    const usage = getDb()
      .prepare('SELECT session_id, turn_id, message_id, execution_id, cost_usd FROM agent_usage WHERE user_id = ?')
      .get('u1') as { session_id: string | null; turn_id: string | null; message_id: string | null; execution_id: string | null; cost_usd: number };
    expect(usage).toMatchObject({
      session_id: 's1',
      turn_id: 't1',
      message_id: 'm1',
      execution_id: 'exec-1',
    });
    expect(usage.cost_usd).toBe(0.001);

    const state = getDb().prepare('SELECT session_state FROM sessions WHERE id = ?').get('s1') as { session_state: string | null };
    expect(state.session_state).toContain('"updated_at"');

    const turn = getDb()
      .prepare('SELECT invocation_mode, provider_type, provider_session_id FROM session_turns WHERE id = ?')
      .get('t1') as { invocation_mode: string | null; provider_type: string | null; provider_session_id: string | null };
    expect(turn.invocation_mode).toBe('new_provider_session');
    expect(turn.provider_type).toBe('codex');
    expect(turn.provider_session_id).toBeNull();
  });

  it('retries codex once without resume when the saved thread rollout is missing', async () => {
    const { runAgentTurn } = await import('../../src/services/agent.js');
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, user_id, provider_type, provider_session_id) VALUES ('s2','u1','codex','stale-thread')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m2','s2','user','continue')").run();
    db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t2','s2','m2','running')").run();
    db.prepare("INSERT INTO executions (id, message_id, tool, status) VALUES ('exec-fresh','m2','codex','running')").run();

    mockInvoke
      .mockRejectedValueOnce(new Error('codex exited with code 1: Error: thread/resume: thread/resume failed: no rollout found for thread id 5f3d61d7-bf'))
      .mockImplementationOnce(async (params) => {
        params.onText('Fresh thread response');
        params.onSessionId('fresh-thread');
        return { costUsd: 0.001, executionId: 'exec-fresh' };
      });

    await runAgentTurn('u1', 's2', 'm2');

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][0].resumeSessionId).toBe('stale-thread');
    expect(mockInvoke.mock.calls[1][0].resumeSessionId).toBeNull();

    const turn = db.prepare('SELECT invocation_mode, provider_type, provider_session_id FROM session_turns WHERE id = ?').get('t2') as {
      invocation_mode: string | null; provider_type: string | null; provider_session_id: string | null;
    };
    expect(turn.invocation_mode).toBe('resume_provider_session');
    expect(turn.provider_type).toBe('codex');
    expect(turn.provider_session_id).toBe('stale-thread');

    const session = db.prepare('SELECT provider_session_id FROM sessions WHERE id = ?').get('s2') as { provider_session_id: string | null };
    expect(session.provider_session_id).toBe('fresh-thread');
  });

  it('starts fresh with compact context when session cost exceeds threshold', async () => {
    const { runAgentTurn } = await import('../../src/services/agent.js');
    const db = getDb();
    mockInvoke.mockImplementationOnce(async (params) => {
      params.onText('Hello from provider');
      params.onSessionId('prov-sess-3');
      return { costUsd: 0.001 };
    });
    db.prepare("INSERT INTO sessions (id, user_id, provider_type, provider_session_id, summary) VALUES ('s3','u1','codex','expensive-thread','Earlier useful facts')").run();
    // Seed attributed cost above the $2.50 threshold so the policy goes fresh.
    db.prepare("INSERT INTO agent_usage (id, user_id, session_id, tool, cost_usd) VALUES ('au-s3','u1','s3','codex',3.00)").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m3','s3','user','keep working on it')").run();
    db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t3','s3','m3','running')").run();

    await runAgentTurn('u1', 's3', 'm3');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0].resumeSessionId).toBeNull();
    expect(mockInvoke.mock.calls[0][0].systemPromptSuffix).toContain('Earlier in this session');
  });

  it('runs providers from the pinned project repo path', async () => {
    const { runAgentTurn } = await import('../../src/services/agent.js');
    const db = getDb();
    db.prepare("INSERT INTO spaces (id, user_id, name) VALUES ('sp-agent','u1','Agent Space')").run();
    db.prepare("INSERT INTO projects (id, space_id, user_id, name, repo_path, origin) VALUES ('p-agent','sp-agent','u1','Agent Repo','/tmp/agent-repo','linked')").run();
    db.prepare("INSERT INTO sessions (id, user_id, pinned_project_id) VALUES ('s4','u1','p-agent')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m4','s4','user','work in repo')").run();
    db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t4','s4','m4','running')").run();

    mockInvoke.mockImplementationOnce(async (params) => {
      params.onText('Repo response');
      params.onSessionId('prov-sess-4');
      return { costUsd: 0.001 };
    });

    await runAgentTurn('u1', 's4', 'm4');

    expect(mockInvoke.mock.calls[0][0].repoPath).toBe('/tmp/agent-repo');
  });

  it('clears provider session and checkpoints state on provider usage limits', async () => {
    const { runAgentTurn } = await import('../../src/services/agent.js');
    const db = getDb();
    db.prepare("INSERT INTO sessions (id, user_id, provider_type, provider_session_id) VALUES ('s5','u1','codex','limited-thread')").run();
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES ('m5','s5','user','continue')").run();
    db.prepare("INSERT INTO session_turns (id, session_id, user_message_id, status) VALUES ('t5','s5','m5','running')").run();

    mockInvoke.mockRejectedValueOnce(new Error("You've hit your usage limit · resets 8:50am"));

    await expect(runAgentTurn('u1', 's5', 'm5')).rejects.toThrow(/usage limit/);

    const session = db.prepare('SELECT provider_session_id, session_state FROM sessions WHERE id = ?').get('s5') as {
      provider_session_id: string | null;
      session_state: string | null;
    };
    expect(session.provider_session_id).toBeNull();
    expect(session.session_state).toContain('Provider session hit a usage/rate/session limit');
    expect(session.session_state).toContain('Start a fresh provider session');

    const event = db
      .prepare("SELECT title, metadata FROM session_events WHERE session_id = ? AND type = 'runtime_checkpoint' AND title = 'Provider session reset' LIMIT 1")
      .get('s5') as { title: string; metadata: string } | undefined;
    expect(event?.title).toBe('Provider session reset');
    expect(JSON.parse(event!.metadata)).toMatchObject({ reason: 'provider_limit' });
  });
});
