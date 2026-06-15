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

const userId = newId();
let sessionId: string;
let messageId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();

  // Mirror the real createExecution: insert a row so session_events.execution_id
  // (FK -> executions.id) is satisfied when the agent records project use.
  createExecutionMock.mockImplementation((_userId: string, msgId: string, projectId: string | null, tool: string) => {
    const id = newId();
    getDb().prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)')
      .run(id, msgId, projectId, tool, 'running');
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

  it('includes available projects and project tools in the system prompt', async () => {
    const db = getDb();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(newId(), userId, 'demo', 'Demo project', null, '[]');

    const msgId = newId();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'hi');

    await runAgentTurn(userId, sessionId, msgId);

    const call = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    expect(call.system).toContain('Available projects');
    expect(call.system).toContain('demo');
    expect(call.tools.some((t: { name: string }) => t.name === 'create_project')).toBe(true);
    expect(call.tools.some((t: { name: string }) => t.name === 'delete_project')).toBe(true);
  });

  it('returns "no repo" error for git_op on a project without repo_path and does not call runGitOp', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'norepo', 'No repo project', null, '[]');

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
          content: [{ type: 'tool_use', id: 'tool-1', name: 'git_op', input: { project_id: projectId, op: 'status' } }],
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
    expect(toolResult).toBe("Project 'norepo' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.");
    expect(toolCallCount).toBe(1);
  });

  it('returns "no repo" error for invoke_claude_code on a project without repo_path and does not call invokeClaudeCode', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'norepo2', 'No repo project 2', null, '[]');

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
          content: [{ type: 'tool_use', id: 'tool-2', name: 'invoke_claude_code', input: { project_id: projectId, prompt: 'fix bug' } }],
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
    expect(toolResult).toBe("Project 'norepo2' has no repo. Create a new repo-backed project with create_project (with_repo=true) for this work.");
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
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'memdemo', 'Demo project', null, '[]');

    rememberFact(userId, 'feedback', 'package_manager', 'use pnpm, not npm');
    rememberFact(userId, 'project', 'status', 'auth refactor blocked on legal review', projectId);

    db.prepare('UPDATE sessions SET pinned_project_id = ? WHERE id = ?').run(projectId, sessionId);

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

  it('creates a project artifact from the create_artifact tool', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'artifactdemo', 'Artifact demo', null, '[]');

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
            id: 'tool-artifact',
            name: 'create_artifact',
            input: {
              project_id: projectId,
              kind: 'research',
              title: 'Research Summary',
              content: '# Findings\n\nUseful details.',
              status: 'review',
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

    const artifact = db.prepare('SELECT kind, title, status, mime_type, path FROM artifacts WHERE project_id = ?')
      .get(projectId) as { kind: string; title: string; status: string; mime_type: string; path: string };
    expect(artifact).toMatchObject({
      kind: 'research',
      title: 'Research Summary',
      status: 'review',
      mime_type: 'text/markdown',
    });
    expect(artifact.path).toMatch(/^artifacts\/.+\.md$/);
  });

  it('runs side-effecting tool calls sequentially in model order', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'ordered-git', 'Ordered git project', '/tmp/repo', '[]');

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
          { type: 'tool_use', id: 'tool-add', name: 'git_op', input: { project_id: projectId, op: 'add' } },
          { type: 'tool_use', id: 'tool-commit', name: 'git_op', input: { project_id: projectId, op: 'commit', message: 'test' } },
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
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'parallel-reads', 'Parallel reads project', '/tmp/repo', '[]');

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
          { type: 'tool_use', id: 'tool-read-a', name: 'read_file', input: { project_id: projectId, path: 'a.txt' } },
          { type: 'tool_use', id: 'tool-read-b', name: 'read_file', input: { project_id: projectId, path: 'b.txt' } },
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
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'bookkeeping-fail', 'Bookkeeping fail project', '/tmp/repo', '[]');

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
        content: [{ type: 'tool_use', id: 'tool-bk', name: 'git_op', input: { project_id: projectId, op: 'add' } }],
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
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'eager-session', 'Eager session test', '/tmp/repo', '[]');

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
        content: [{ type: 'tool_use', id: 'tool-cc', name: 'invoke_claude_code', input: { project_id: projectId, prompt: 'fix bug' } }],
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

  it('includes errors array in run_campaign tool result when tasks fail', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'campaign-errors', 'Campaign errors test', null, '[]');

    // Create a campaign with one error task
    const campaignId = newId();
    const taskId = newId();
    const execId = newId();
    db.prepare('INSERT INTO campaigns (id, project_id, session_id, title, status) VALUES (?,?,?,?,?)')
      .run(campaignId, projectId, sessionId, 'Test Campaign', 'error');
    db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status, result) VALUES (?,?,?,?,?,?)')
      .run(execId, null, projectId, 'subagent', 'error', 'Exit 1: jest not found — full error message here');
    db.prepare('INSERT INTO campaign_tasks (id, campaign_id, title, agent, position, status, execution_id) VALUES (?,?,?,?,?,?,?)')
      .run(taskId, campaignId, 'Run tests', 'subagent', 0, 'error', execId);

    // Lead agent calls run_campaign
    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-rc', name: 'run_campaign', input: { campaign_id: campaignId } }],
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
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?,?,?,?)').run(msgId, sessionId, 'user', 'run the campaign');
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
      task_id: taskId,
      title: 'Run tests',
      error: expect.stringContaining('jest not found'),
    });
  });

  it('returns the create_artifact success result even when its session event fails', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'artifact-bk-fail', 'Artifact bookkeeping fail', null, '[]');

    // Bad execution id -> the artifact_created session event violates the FK and
    // throws, but the artifact was already created and the tool must still succeed.
    createExecutionMock.mockImplementationOnce(() => 'exec-missing-artifact');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{
          type: 'tool_use',
          id: 'tool-artifact-bk',
          name: 'create_artifact',
          input: { project_id: projectId, kind: 'research', title: 'Resilient Report', content: '# Body', status: 'review' },
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

    // Artifact persisted...
    const artifact = db.prepare('SELECT title FROM artifacts WHERE project_id = ?').get(projectId) as { title: string } | undefined;
    expect(artifact?.title).toBe('Resilient Report');

    // ...and the tool reported success, not an error masked by the failed event.
    const secondCall = streamMock.mock.calls[streamMock.mock.calls.length - 1][0];
    const toolResultMsg = secondCall.messages.find((m: { role: string; content: unknown }) =>
      m.role === 'user' && Array.isArray(m.content) && (m.content as { type: string }[]).some(c => c.type === 'tool_result')
    );
    const toolResult = (toolResultMsg.content as { content: string }[])[0].content;
    expect(toolResult).toContain('artifact_id');
    expect(toolResult).not.toContain('Error');
    expect(errSpy).toHaveBeenCalledWith('emitSessionEvent failed (non-fatal):', expect.anything());
    errSpy.mockRestore();
  });

  it('generate_video returns structured JSON with execution_id', async () => {
    const db = getDb();
    const projectId = newId();
    db.prepare('INSERT INTO projects (id, user_id, name, description, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?,?)')
      .run(projectId, userId, 'video-json', 'Video JSON test', null, '[]');

    streamMock.mockImplementationOnce(() => ({
      on: () => ({ on: () => ({ finalMessage: async () => ({}) }) }),
      finalMessage: async () => ({
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tool-vid', name: 'generate_video', input: { project_id: projectId, title: 'Test', scenes: [{ text: 'hello', durationInSeconds: 2 }] } }],
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
    db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status, result) VALUES (?,?,?,?,?,?)')
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
    db.prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)')
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
