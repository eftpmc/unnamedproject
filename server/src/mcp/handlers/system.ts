import { execFile } from 'child_process';
import { promisify } from 'util';
import { registerTool } from '../registry.js';
import { getToolsDir } from '../../db/index.js';
import { createExecution, completeExecution, requestApproval, appendOutput } from '../../services/executor.js';

const execFileAsync = promisify(execFile);

export function registerSystemHandlers(): void {
  registerTool({
    name: 'get_tools_dir',
    description: 'Returns the managed tools directory path. Always write custom MCP server scripts here, never to home, Desktop, or Documents.',
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
        { command, reason, session_id: sessionId },
        'user',
      );

      if (decision === 'rejected') {
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
}
