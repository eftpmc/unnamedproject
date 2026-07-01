import { execFile } from 'child_process';
import { promisify } from 'util';
import { registerTool } from '../registry.js';
import { getToolsDir } from '../../db/index.js';
import { createExecution, completeExecution, requestApproval, requestInput, appendOutput } from '../../services/executor.js';

const execFileAsync = promisify(execFile);

export function registerSystemHandlers(): void {
  registerTool({
    name: 'get_tools_dir',
    description: 'Returns the managed tools directory path. Prefer create_tool_package for generated MCP servers; use this only for inspection/debugging. Never write tools to home, Desktop, or Documents.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => getToolsDir(),
  });

  registerTool({
    name: 'install_dependency',
    description: 'Install a system-level dependency (e.g. uvx, a Homebrew package, a global npm package). Always requires user approval before running. Provide a clear reason the user will see in the approval prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The exact shell command to run, e.g. "curl -LsSf https://astral.sh/uv/install.sh | sh"' },
        reason: { type: 'string', description: 'Short explanation shown to the user, e.g. "Install uvx to run the LinkedIn MCP server"' },
      },
      required: ['command', 'reason'],
    },
    handler: async (args, userId, sessionId) => {
      const command = args.command as string;
      const reason = args.reason as string;

      const executionId = createExecution(userId, null, null, 'install_dependency');

      const decision = await requestApproval(
        executionId,
        userId,
        'install_dependency',
        { command, reason, session_id: sessionId, ui: { kind: 'dependency', command, packageName: command.split(/\s+/)[1] ?? command, reason } },
        'user',
      );

      if (decision.decision === 'rejected') {
        completeExecution(executionId, userId, 'error', 'User rejected dependency install.');
        return 'Cancelled: user did not approve the install. Do not retry automatically.';
      }

      try {
        appendOutput(executionId, userId, `Running: ${command}\n`);
        const { stdout, stderr } = await execFileAsync('sh', ['-c', command], {
          timeout: 5 * 60 * 1000,
          env: { ...process.env, HOME: process.env.HOME ?? '/tmp' },
        });
        const output = [stdout, stderr].filter(Boolean).join('\n');
        completeExecution(executionId, userId, 'done', output || 'done');
        return output || 'Install completed successfully.';
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        completeExecution(executionId, userId, 'error', msg);
        return `Error: install failed — ${msg}`;
      }
    },
  });

  registerTool({
    name: 'ask_user',
    description: 'Ask the user a structured question and wait for their answer. Use for multi-step input gathering before taking an action. Call sequentially for multi-step flows (step 1, step 2, etc.). Returns { answer: string }.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask' },
        options: { type: 'array', items: { type: 'string' }, description: 'Optional list of choices. If omitted, shows a text input.' },
        type: { type: 'string', enum: ['single', 'multi', 'text'], description: 'single = one choice, multi = multiple choices, text = free text' },
        step: { type: 'number', description: 'Current step number (1-based) if part of a sequence' },
        total: { type: 'number', description: 'Total steps in the sequence' },
        skippable: { type: 'boolean', description: 'Whether the user can skip this question' },
      },
      required: ['question'],
    },
    handler: async (args, userId, sessionId) => {
      const executionId = createExecution(userId, null, null, 'ask_user');
      const answer = await requestInput(executionId, userId, 'ask_user', {
        session_id: sessionId,
        ui: {
          kind: 'question',
          question: args.question,
          options: args.options,
          type: args.type ?? (args.options ? 'single' : 'text'),
          step: args.step,
          total: args.total,
          skippable: args.skippable ?? false,
        },
      });
      completeExecution(executionId, userId, 'done', answer ?? '(skipped)');
      if (answer === null) return JSON.stringify({ skipped: true });
      return JSON.stringify({ answer });
    },
  });

  registerTool({
    name: 'vault_request_secret',
    description: 'Ask the user to enter a secret value (API key, password, token) via a secure masked input. The value is stored in the vault under the given key and returned. Use when vault_get returns nothing and you need the credential to continue.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Vault key to store the secret under (e.g. "linkedin_api_key")' },
        label: { type: 'string', description: 'Human-readable name shown to the user (e.g. "LinkedIn API Key")' },
        description: { type: 'string', description: 'One sentence explaining why this secret is needed' },
        placeholder: { type: 'string', description: 'Optional placeholder text for the input field' },
      },
      required: ['key', 'label', 'description'],
    },
    handler: async (args, userId, sessionId) => {
      const key = String(args.key).trim().toLowerCase();
      const executionId = createExecution(userId, null, null, 'vault_request_secret');
      const value = await requestInput(executionId, userId, 'vault_request_secret', {
        session_id: sessionId,
        ui: {
          kind: 'secret_entry',
          key,
          label: args.label,
          description: args.description,
          placeholder: args.placeholder,
        },
      });
      if (!value) {
        completeExecution(executionId, userId, 'error', 'User did not provide the secret.');
        return 'User cancelled. Do not retry automatically.';
      }
      const { encrypt, deriveKey } = await import('../../lib/crypto.js');
      const { newId } = await import('../../lib/ids.js');
      const { getDb } = await import('../../db/index.js');
      const encrypted = encrypt(value, deriveKey());
      getDb()
        .prepare(`INSERT INTO vault_entries (id, user_id, key, encrypted_value) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, key) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = unixepoch()`)
        .run(newId(), userId, key, encrypted);
      completeExecution(executionId, userId, 'done', `Stored "${key}" in vault.`);
      return value;
    },
  });
}
