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
  createExecution: vi.fn().mockReturnValue('exec-1'),
  completeExecution: vi.fn(),
  appendOutput: vi.fn(),
  requestApproval: vi.fn().mockResolvedValue('approved'),
}));

const { runGitOpMock, invokeClaudeCodeMock, invokeCodexMock } = vi.hoisted(() => ({
  runGitOpMock: vi.fn().mockResolvedValue('git op result'),
  invokeClaudeCodeMock: vi.fn().mockResolvedValue('claude code result'),
  invokeCodexMock: vi.fn().mockResolvedValue('codex result'),
}));
vi.mock('../../src/tools/git_op.js', () => ({ runGitOp: runGitOpMock }));
vi.mock('../../src/tools/invoke_claude_code.js', () => ({ invokeClaudeCode: invokeClaudeCodeMock }));
vi.mock('../../src/tools/invoke_codex.js', () => ({ invokeCodex: invokeCodexMock }));

const userId = newId();
let sessionId: string;
let messageId: string;

beforeAll(async () => {
  fs.mkdirSync(process.env.DATA_DIR!, { recursive: true });
  initDb();
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
});
