import fs from 'fs';
import os from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { initDb, getDb } from '../src/db/index.js';
import { newId } from '../src/lib/ids.js';
import { ensureWorktree } from '../src/lib/worktree.js';
import { invokeClaudeCode } from '../src/tools/invoke_claude_code.js';
import { runProjectQuery } from '../src/tools/project_query.js';
import { encrypt, deriveKey } from '../src/lib/crypto.js';
import type { DbProject } from '../src/db/index.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-data-'));
initDb();

const userId = newId();
getDb().prepare('INSERT INTO users (id, email, hashed_password) VALUES (?,?,?)').run(userId, `${userId}@test.com`, 'x');

const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
const connId = newId();
const encryptedConfig = encrypt(JSON.stringify({ apiKey: anthropicKey }), deriveKey());
getDb()
  .prepare('INSERT INTO connections (id, user_id, name, type, purpose, encrypted_config) VALUES (?,?,?,?,?,?)')
  .run(connId, userId, 'smoke-anthropic', 'anthropic', 'lead_agent', encryptedConfig);

const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-repo-'));
await simpleGit(repoPath).init();
// Code-only repo so graphify doesn't need an LLM key for doc extraction
fs.writeFileSync(path.join(repoPath, 'index.ts'), 'export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n');
fs.writeFileSync(path.join(repoPath, 'utils.ts'), 'export function add(a: number, b: number): number { return a + b; }\n');
await simpleGit(repoPath).add('.').commit('initial commit');

const projectId = newId();
getDb()
  .prepare('INSERT INTO projects (id, user_id, name, repo_path, enabled_connection_ids) VALUES (?,?,?,?,?)')
  .run(projectId, userId, 'smoke-project', repoPath, '[]');
const project = getDb()
  .prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ?')
  .get(projectId) as DbProject;

const sessionId = newId();
getDb().prepare('INSERT INTO sessions (id, user_id) VALUES (?,?)').run(sessionId, userId);

const messageId = newId();
getDb().prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?,?,'user','smoke test')").run(messageId, sessionId);

function makeExecution(tool: string): string {
  const execId = newId();
  getDb().prepare('INSERT INTO executions (id, message_id, project_id, tool, status) VALUES (?,?,?,?,?)').run(execId, messageId, projectId, tool, 'running');
  return execId;
}

console.log('--- Step 1: project_query (plan mode) ---');
const queryResult = await runProjectQuery({ project_id: projectId, question: 'What files are in this repo?' }, userId, anthropicKey || null);
console.log(queryResult);

console.log('\n--- Step 2: ensureWorktree ---');
const worktree = await ensureWorktree(project, sessionId);
console.log('worktree:', worktree);

console.log('\n--- Step 3: invoke_claude_code (turn 1, create a file) ---');
const r1 = await invokeClaudeCode(
  { prompt: 'Create a file named hello.txt containing the text "hello world" and nothing else.' },
  { userId, executionId: makeExecution('invoke_claude_code'), repoPath: worktree.worktree_path, apiKey: anthropicKey || null, resumeSessionId: worktree.claude_session_id }
);
console.log('result:', r1.result);
console.log('sessionId:', r1.sessionId);
console.log('hello.txt exists in worktree:', fs.existsSync(path.join(worktree.worktree_path, 'hello.txt')));
console.log('hello.txt exists in main repo:', fs.existsSync(path.join(repoPath, 'hello.txt')));

console.log('\n--- Step 4: invoke_claude_code (turn 2, resume + verify continuity) ---');
const r2 = await invokeClaudeCode(
  { prompt: 'What did you just create in the previous step? Reply with just the filename.' },
  { userId, executionId: makeExecution('invoke_claude_code'), repoPath: worktree.worktree_path, apiKey: anthropicKey || null, resumeSessionId: r1.sessionId }
);
console.log('result:', r2.result);
console.log('sessionId:', r2.sessionId);

console.log('\n--- Step 5: git status in worktree ---');
const status = await simpleGit(worktree.worktree_path).status();
console.log('current branch:', status.current);
console.log('not_added/created:', status.not_added, status.created);

console.log('\nDone.');
