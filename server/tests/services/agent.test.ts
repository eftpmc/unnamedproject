import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import { initDb, getDb } from '../../src/db/index.js';
import { runAgentTurn } from '../../src/services/agent.js';
import { newId } from '../../src/lib/ids.js';

const streamMock = vi.fn().mockImplementation(() => {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const stream = {
    on: (event: string, cb: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(cb);
      return stream;
    },
    finalMessage: async () => {
      for (const cb of listeners.text ?? []) cb('Hello! How can I help?');
      return {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    },
  };
  return stream;
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      stream: streamMock,
    },
  })),
}));

vi.mock('../../src/services/socket.js', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/services/executor.js', () => ({
  createExecution: createExecutionMock,
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const { runGitOpMock, invokeClaudeCodeMock, invokeCodexMock, ensureWorktreeMock, readFileMock, createExecutionMock } = vi.hoisted(() => ({
  createExecutionMock: vi.fn(),
  runGitOpMock: vi.fn().mockResolvedValue('git op result'),
  invokeClaudeCodeMock: vi.fn().mockResolvedValue('claude code result'),
  invokeCodexMock: vi.fn().mockResolvedValue('codex result'),
  readFileMock: vi.fn().mockResolvedValue('file contents'),
  ensureWorktreeMock: vi.fn().mockResolvedValue({
    id: 'worktree-1',
    project_id: 'project-1',
    session_id: 'session-1',
    branch: 'agent/session-1',
    worktree_path: '/tmp/agent-worktree',
    claude_session_id: null,
    codex_session_id: null,
    created_at: 0,
  }),
}));
vi.mock('../../src/tools/git_op.js', () => ({ runGitOp: runGitOpMock }));
vi.mock('../../src/tools/invoke_claude_code.js', () => ({ invokeClaudeCode: invokeClaudeCodeMock }));
vi.mock('../../src/tools/invoke_codex.js', () => ({ invokeCodex: invokeCodexMock }));
vi.mock('../../src/lib/worktree.js', () => ({ ensureWorktree: ensureWorktreeMock }));
vi.mock('../../src/tools/file_ops.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/tools/file_ops.js')>('../../src/tools/file_ops.js');
  return { ...actual, readFile: readFileMock };
});
vi.mock('../../src/services/video.js', () => ({
  renderVideo: vi.fn().mockResolvedValue('test-video.mp4'),
}));
vi.mock('../../src/lib/mcp-pool.js', () => ({
  listMcpTools: vi.fn().mockResolvedValue([
    { name: 'create_pr', description: 'Create a pull request', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  ]),
  callMcpTool: vi.fn().mockResolvedValue('mcp tool result'),
}));

const userId = newId();
let sessionId: string;
let messageId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();

  // Mirror the real createExecution: insert a row so session_events.execution_id
  // (FK -> executions.id) is satisfied when the agent records project use.
  createExecutionMock.mockImplementation((_userId: string, msgId: string, spaceId: string | null, tool: string) => {
    const id = newId();
    getDb().prepare('INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)')
      .run(id, msgId, spaceId, tool, 'running');
    return id;
  });

  const db = getDb();
  db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `agent-${userId}@test.com`, 'x');

  // Insert Anthropic connection (encrypted config)
  const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
  db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
    .run(newId(), userId, 'main', 'anthropic', encrypt(JSON.stringify({ apiKey: 'sk-test' }), deriveKey()));

  sessionId = newId();
  db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);
  messageId = newId();
  db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(messageId, sessionId, 'user', 'Hello');
});

describe('agent', () => {
  it('persists an assistant message', async () => {
    await runAgentTurn(userId, sessionId, messageId);
    const rows = getDb().prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'assistant'").all(sessionId) as { content: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe('Hello! How can I help?');
  });

  it('uses a stable Anthropic messages payload', async () => {
    streamMock.mockClear();
    await runAgentTurn(userId, sessionId, messageId);

    const payload = streamMock.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      max_tokens: 8192,
      messages: expect.any(Array),
      tools: expect.any(Array),
    });
    expect(payload).not.toHaveProperty('effort');
    expect(payload).not.toHaveProperty('thinking');
  });

  it('includes available projects in the system prompt', async () => {
    const db = getDb();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(newId(), userId, 'demo', 'Demo project', '[]');

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('Available projects');
    expect(call.system).toContain('demo');
  });

  it('makes project tools available via tool_search discovery', async () => {
    const { addSessionDiscoveredTools } = await import('../../src/db/index.js');
    const { resolveToolsForTurn } = await import('../../src/services/agent.js');
    const discoverySessionId = newId();
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(discoverySessionId, userId);

    addSessionDiscoveredTools(discoverySessionId, ['create_project', 'delete_project']);
    const tools = resolveToolsForTurn(userId, discoverySessionId);
    const names = tools.map(t => t.name);
    expect(names).toContain('create_project');
    expect(names).toContain('delete_project');
  });

  it('returns "no repo" error for git_op on a project without repo_path and does not call runGitOp', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'norepo', 'No repo project', '[]');

    runGitOpMock.mockClear();

    let toolCallCount = 0;
    streamMock.mockImplementationOnce(() => {
      toolCallCount++;
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'tool_use', id: 'tool-1', name: 'git_op', input: { space_id: projectId, item_id: 'missing-item', op: 'status' } }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: 'done' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'do git status');

    await runAgentTurn(userId, sessionId, msgId);

    expect(runGitOpMock).not.toHaveBeenCalled();

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toBe("Repo item missing-item not found in Space 'norepo'.");
    expect(toolCallCount).toBe(1);
  });

  it('returns "no repo" error for invoke_claude_code on a project without repo_path and does not call invokeClaudeCode', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'norepo2', 'No repo project 2', '[]');

    invokeClaudeCodeMock.mockClear();

    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'tool_use', id: 'tool-2', name: 'invoke_claude_code', input: { space_id: projectId, item_id: 'missing-item', prompt: 'fix bug' } }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: 'done' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'fix the bug');

    await runAgentTurn(userId, sessionId, msgId);

    expect(invokeClaudeCodeMock).not.toHaveBeenCalled();

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toBe("Repo item missing-item not found in Space 'norepo2'.");
  });

  it('renders "No memories stored yet." in the system prompt when memory is empty', async () => {
    const db = getDb();
    const freshUserId = newId();
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(freshUserId, `agent-fresh-${freshUserId}@test.com`, 'x');
    const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
    db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(newId(), freshUserId, 'main', 'anthropic', encrypt(JSON.stringify({ apiKey: 'sk-test' }), deriveKey()));

    const freshSessionId = newId();
    db.prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(freshSessionId, freshUserId);
    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, freshSessionId, 'user', 'hi');

    streamMock.mockClear();
    await runAgentTurn(freshUserId, freshSessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('User memory:\nNo memories stored yet.');
  });

  it('renders typed and project-linked memory entries in the system prompt', async () => {
    const db = getDb();
    const { rememberFact } = await import('../../src/services/memory.js');

    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'memdemo', 'Demo project', '[]');

    rememberFact(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
    rememberFact(userId, 'project', 'status', 'auth refactor blocked on legal review', projectId);

    db.prepare('UPDATE sessions SET pinned_space_id = ? WHERE id = ?').run(projectId, sessionId);

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    streamMock.mockClear();
    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('- [feedback] package_manager: use pnpm, not npm');
    expect(call.system).toContain('- [project: memdemo] status: auth refactor blocked on legal review');
  });

  it('includes recent chat titles in the system prompt', async () => {
    const db = getDb();
    const recentSessionId = newId();
    db.prepare('INSERT INTO sessions (id, user_id, title) VALUES (?,?,?)').run(recentSessionId, userId, 'My recent chat');

    streamMock.mockClear();

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'what have I been working on?');

    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[0][0];
    expect(call.system).toContain('My recent chat');
    expect(call.system).toContain(recentSessionId);
  });

  it('creates a note item from the create_note tool', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'artifactdemo', 'Artifact demo', '[]');

    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{
            type: 'tool_use',
            id: 'tool-note',
            name: 'create_note',
            input: {
              space_id: projectId,
              name: 'Research Summary',
              content: '# Findings\n\nUseful details.',
            },
          }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('created');
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: 'created' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(msgId, sessionId, 'user', 'save this research');

    await runAgentTurn(userId, sessionId, msgId);

    const note = db.prepare(`
      SELECT item.name, note.content
      FROM space_items item
      JOIN space_notes note ON note.item_id = item.id
      WHERE item.space_id = ? AND item.type = 'note'
    `).get(projectId) as { name: string; content: string };
    expect(note).toEqual({ name: 'Research Summary', content: '# Findings\n\nUseful details.' });
  });

  it('runs side-effecting tool calls sequentially in model order', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'ordered-git', 'Ordered git project', '[]');
    const repoItemId = newId();
    db.prepare('INSERT INTO space_items (id, space_id, type, name, created_at) VALUES (?,?,?,?,?)').run(repoItemId, projectId, 'repo', 'ordered-git', Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?,?,?)').run(repoItemId, '/tmp/repo', null);

    const events: string[] = [];
    runGitOpMock.mockReset();
    runGitOpMock.mockImplementationOnce(async () => {
      events.push('add:start');
      await new Promise(resolve => setTimeout(resolve, 25));
      events.push('add:end');
      return 'staged 1 file(s)';
    });
    runGitOpMock.mockImplementationOnce(async () => {
      events.push('commit:start');
      events.push('commit:end');
      return 'committed: test';
    });

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'tool-add', name: 'git_op', input: { space_id: projectId, item_id: repoItemId, op: 'add' } },
          { type: 'tool_use', id: 'tool-commit', name: 'git_op', input: { space_id: projectId, item_id: repoItemId, op: 'commit', message: 'test' } },
        ],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(msgId, sessionId, 'user', 'commit the changes');

    await runAgentTurn(userId, sessionId, msgId);

    expect(events).toEqual(['add:start', 'add:end', 'commit:start', 'commit:end']);
    expect(runGitOpMock).toHaveBeenCalledTimes(2);
  });

  it('runs read-only tool calls in parallel', async () => {
    const events: string[] = [];
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'parallel-reads', 'Parallel reads project', '[]');
    const repoItemId = newId();
    db.prepare('INSERT INTO space_items (id, space_id, type, name, created_at) VALUES (?,?,?,?,?)').run(repoItemId, projectId, 'repo', 'parallel-reads', Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?,?,?)').run(repoItemId, '/tmp/repo', null);

    readFileMock.mockReset();
    readFileMock.mockImplementationOnce(async () => {
      events.push('a:start');
      await new Promise(resolve => setTimeout(resolve, 25));
      events.push('a:end');
      return 'a';
    });
    readFileMock.mockImplementationOnce(async () => {
      events.push('b:start');
      events.push('b:end');
      return 'b';
    });

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'tool-read-a', name: 'read_file', input: { space_id: projectId, item_id: repoItemId, path: 'a.txt' } },
          { type: 'tool_use', id: 'tool-read-b', name: 'read_file', input: { space_id: projectId, item_id: repoItemId, path: 'b.txt' } },
        ],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    getDb().prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)')
      .run(msgId, sessionId, 'user', 'read two files');

    await runAgentTurn(userId, sessionId, msgId);

    expect(events).toEqual(['a:start', 'b:start', 'b:end', 'a:end']);
  });

  it('dispatches the forget tool', async () => {
    const db = getDb();
    const { rememberFact, recallFact } = await import('../../src/services/memory.js');
    rememberFact(userId, 'user', 'scratch_note', 'temporary');

    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'tool_use', id: 'tool-3', name: 'forget', input: { type: 'user', key: 'scratch_note' } }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: 'done' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'forget the scratch note');

    await runAgentTurn(userId, sessionId, msgId);

    expect(recallFact(userId, 'user', 'scratch_note')).toBeNull();

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toBe('Forgot [user] scratch_note');
  });

  it('still dispatches the tool when project bookkeeping (session event) fails', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'bookkeeping-fail', 'Bookkeeping fail project', '[]');
    const repoItemId = newId();
    db.prepare('INSERT INTO space_items (id, space_id, type, name, created_at) VALUES (?,?,?,?,?)').run(repoItemId, projectId, 'repo', 'bookkeeping-fail', Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?,?,?)').run(repoItemId, '/tmp/repo', null);

    // Return an execution id with no backing row. noteProjectUse -> createSessionEvent
    // then violates the execution_id FK and throws — but that bookkeeping failure
    // must not abort the actual tool call.
    createExecutionMock.mockImplementationOnce(() => 'exec-missing');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    runGitOpMock.mockReset();
    runGitOpMock.mockResolvedValue('staged 1 file(s)');

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-bk', name: 'git_op', input: { space_id: projectId, item_id: repoItemId, op: 'add' } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'stage the changes');

    // Would reject here (FK violation in noteProjectUse) before the fix.
    await runAgentTurn(userId, sessionId, msgId);
    expect(runGitOpMock).toHaveBeenCalledTimes(1);
    // The bookkeeping failure is swallowed but logged, not silently dropped.
    expect(errSpy).toHaveBeenCalledWith('emitSessionEvent failed (non-fatal):', expect.anything());
    errSpy.mockRestore();
  });

  it('passes onSessionId callback to invokeClaudeCode which fires eagerly', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'eager-session', 'Eager session test', '[]');
    const repoItemId = newId();
    db.prepare('INSERT INTO space_items (id, space_id, type, name, created_at) VALUES (?,?,?,?,?)').run(repoItemId, projectId, 'repo', 'eager-session', Math.floor(Date.now() / 1000));
    db.prepare('INSERT INTO space_repos (item_id, repo_path, default_branch) VALUES (?,?,?)').run(repoItemId, '/tmp/repo', null);

    const capturedIds: string[] = [];
    invokeClaudeCodeMock.mockImplementationOnce(
      async (_input: unknown, ctx: { onSessionId?: (id: string) => void }) => {
        if (ctx.onSessionId) {
          ctx.onSessionId('eager-session-abc');
          capturedIds.push('eager-session-abc');
        }
        return { result: 'done', sessionId: 'eager-session-abc', costUsd: 0 };
      }
    );

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-cc', name: 'invoke_claude_code', input: { space_id: projectId, item_id: repoItemId, prompt: 'fix bug' } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'fix the bug');
    await runAgentTurn(userId, sessionId, msgId);

    // Verify the onSessionId callback was passed and called with the session ID
    expect(capturedIds).toEqual(['eager-session-abc']);
  });

  it('respects max_turns on delegate_to_agent and stops after N turns', async () => {
    const db = getDb();

    // Mock Anthropic to always return tool_use so the sub-agent never ends naturally
    const subAgentMock = vi.fn()
      .mockResolvedValue({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'sub-tool-1', name: 'recall', input: { type: 'user' } }],
        usage: { input_tokens: 5, output_tokens: 5 },
      });

    // We need to intercept the sub-agent's Anthropic calls separately from the
    // lead agent's stream. The sub-agent uses client.messages.create (not stream).
    // Patch it via the existing Anthropic mock.
    // Order matters: runAgentTurn creates its client first (needs stream),
    // then runSubAgent creates its own client (needs create).
    const anthropicMod = await import('@anthropic-ai/sdk');
    const ClientCls = vi.mocked(anthropicMod.default);
    // Slot 1: lead agent (runAgentTurn creates its client first)
    ClientCls.mockImplementationOnce(() => ({
      messages: { stream: streamMock },
    }));
    // Slot 2: listClaudeModels fires after the lead agent client is constructed
    // (it's fire-and-forget, so it races for the next constructor slot)
    ClientCls.mockImplementationOnce(() => ({
      messages: { stream: streamMock },
    }));
    // Slot 3: sub-agent (runSubAgent creates its own client after dispatchTool is called)
    ClientCls.mockImplementationOnce(() => ({
      messages: { create: subAgentMock },
    }));

    // Lead agent emits delegate_to_agent with max_turns: 2
    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-da', name: 'delegate_to_agent', input: { instructions: 'do something', max_turns: 2 } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'delegate something');
    await runAgentTurn(userId, sessionId, msgId);

    // Sub-agent should have been called exactly 2 times (max_turns: 2)
    expect(subAgentMock).toHaveBeenCalledTimes(2);
  });

  it('includes errors array in run_plan tool result when steps fail', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'plan-errors', 'Plan errors test', '[]');

    // Create a plan with one errored step
    const planId = newId();
    const stepId = newId();
    const execId = newId();
    db.prepare('INSERT INTO plans (id, space_id, session_id, title, status) VALUES (?,?,?,?,?)')
      .run(planId, projectId, sessionId, 'Test Plan', 'error');
    db.prepare('INSERT INTO executions (id, message_id, space_id, tool, status, result) VALUES (?,?,?,?,?,?)')
      .run(execId, null, projectId, 'subagent', 'error', 'Exit 1: jest not found — full error message here');
    db.prepare('INSERT INTO plan_steps (id, plan_id, title, agent, position, status, execution_id) VALUES (?,?,?,?,?,?,?)')
      .run(stepId, planId, 'Run tests', 'subagent', 0, 'error', execId);

    // Lead agent calls run_plan
    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-rc', name: 'run_plan', input: { plan_id: planId } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('noted');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'noted' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run the plan');
    await runAgentTurn(userId, sessionId, msgId);

    // Inspect what the lead agent received as the tool result
    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);

    expect(toolResult.errors).toBeDefined();
    expect(toolResult.errors).toHaveLength(1);
    expect(toolResult.errors[0]).toMatchObject({
      step_id: stepId,
      title: 'Run tests',
      error: expect.stringContaining('jest not found'),
    });
  });

  it('returns the create_note success result even when its session event fails', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'artifact-bk-fail', 'Artifact bookkeeping fail', '[]');

    // Bad execution id -> the item_created session event violates the FK and
    // throws, but the note was already created and the tool must still succeed.
    createExecutionMock.mockImplementationOnce(() => 'exec-missing-artifact');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{
          type: 'tool_use',
          id: 'tool-note-bk',
          name: 'create_note',
          input: { space_id: projectId, name: 'Resilient Report', content: '# Body' },
        }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'save this report');

    await runAgentTurn(userId, sessionId, msgId);

    // Note persisted...
    const item = db.prepare("SELECT name FROM space_items WHERE space_id = ? AND type = 'note'").get(projectId) as { name: string } | undefined;
    expect(item?.name).toBe('Resilient Report');

    // ...and the tool reported success, not an error masked by the failed event.
    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toContain('"type":"note"');
    expect(toolResult).not.toContain('Error');
    expect(errSpy).toHaveBeenCalledWith('emitSessionEvent failed (non-fatal):', expect.anything());
    errSpy.mockRestore();
  });

  it('generate_video returns structured JSON with execution_id', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO spaces (id, user_id, name, description, enabled_connection_ids) VALUES (?,?,?,?,?)')
      .run(projectId, userId, 'video-json', 'Video JSON test', '[]');

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-vid', name: 'generate_video', input: { space_id: projectId, title: 'Test', scenes: [{ text: 'hello', durationInSeconds: 2 }] } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('video started');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'video started' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'render a video');
    await runAgentTurn(userId, sessionId, msgId);

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);
    expect(toolResult.execution_id).toBeDefined();
    expect(toolResult.status).toBe('started');
    expect(toolResult.message).toContain('wait_for_execution');
  });

  it('wait_for_execution returns result when execution reaches done state', async () => {
    const db = getDb();
    const execId = newId();
    db.prepare('INSERT INTO executions (id, message_id, space_id, tool, status, result) VALUES (?,?,?,?,?,?)')
      .run(execId, null, null, 'generate_video', 'done', 'Rendered test-video.mp4');

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-wfe', name: 'wait_for_execution', input: { execution_id: execId } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'done' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'wait for the video');
    await runAgentTurn(userId, sessionId, msgId);

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = JSON.parse((toolResultMsg.content as { content: string }[])[0].content);
    expect(toolResult.status).toBe('done');
    expect(toolResult.result).toBe('Rendered test-video.mp4');
  });

  it('wait_for_execution returns error string on timeout', async () => {
    const db = getDb();
    const execId = newId();
    db.prepare('INSERT INTO executions (id, message_id, space_id, tool, status) VALUES (?,?,?,?,?)')
      .run(execId, null, null, 'generate_video', 'running');

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-wfe2', name: 'wait_for_execution', input: { execution_id: execId, timeout_seconds: 1 } }],
      }),
    }));
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => { (listeners[event] ??= []).push(cb); return { on: () => ({ finalMessage: async () => ({}) }) }; },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('noted');
          return { stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 }, content: [{ type: 'text', text: 'noted' }] };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'wait for video with timeout');
    await runAgentTurn(userId, sessionId, msgId);

    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toContain('Error');
    expect(toolResult).toContain('still running');
  }, 10_000);
});

describe('tool discovery in runAgentTurn', () => {
  it('always-loaded core set includes tool_search and excludes the full static list', async () => {
    const { resolveToolsForTurn } = await import('../../src/services/agent.js');
    const discoverySessionId = newId();
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(discoverySessionId, userId);

    const tools = resolveToolsForTurn(userId, discoverySessionId);
    const names = tools.map(t => t.name);
    expect(names).toContain('tool_search');
    expect(names).toContain('delegate_to_agent');
    expect(names).not.toContain('generate_video'); // not in core, not yet discovered
  });

  it('includes a previously discovered tool on subsequent calls', async () => {
    const { addSessionDiscoveredTools } = await import('../../src/db/index.js');
    const { resolveToolsForTurn } = await import('../../src/services/agent.js');
    const discoverySessionId = newId();
    getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(discoverySessionId, userId);

    addSessionDiscoveredTools(discoverySessionId, ['generate_video']);
    const tools = resolveToolsForTurn(userId, discoverySessionId);
    expect(tools.map(t => t.name)).toContain('generate_video');
  });

  it('list_connections ingests MCP tools into the registry as a side effect', async () => {
    const db = getDb();
    const { encrypt, deriveKey } = await import('../../src/lib/crypto.js');
    const connId = newId();
    db.prepare('INSERT INTO connections (id, user_id, name, type, encrypted_config) VALUES (?,?,?,?,?)')
      .run(connId, userId, 'gh-mcp', 'mcp', encrypt(JSON.stringify({ command: 'mock-mcp', args: '[]', env: '{}' }), deriveKey()));

    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => ({
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: 'tool_use', id: 'tool-list-conns', name: 'list_connections', input: {} }],
        }),
      };
    });
    streamMock.mockImplementationOnce(() => {
      const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
      return {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          (listeners[event] ??= []).push(cb);
          return { on: () => ({ finalMessage: async () => ({}) }) };
        },
        finalMessage: async () => {
          for (const cb of listeners.text ?? []) cb('done');
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
            content: [{ type: 'text', text: 'done' }],
          };
        },
      };
    });

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'list connections');

    await runAgentTurn(userId, sessionId, msgId);

    const { getMcpRegistryToolsForUser } = await import('../../src/db/index.js');
    const registered = getMcpRegistryToolsForUser(userId);
    expect(registered.some(t => t.connection_id === connId && t.mcp_tool_name === 'create_pr')).toBe(true);
  });
});
