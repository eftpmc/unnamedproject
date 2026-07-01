import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { getDecryptedConfig } from '../../routes/connections.js';
import { createConnectionTool } from '../../tools/connection_ops.js';
import { closeMcpConnection, listMcpTools } from '../../lib/mcp-pool.js';
import { createExecution, completeExecution, requestApproval } from '../../services/executor.js';

export function registerConnectionHandlers(): void {
  registerTool({
    name: 'list_connections',
    description: 'List all configured connections. Web connections include url and notes fields for the agent to reference.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const conns = getDb()
        .prepare('SELECT id, name, type, purpose, service, url, notes FROM connections WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Array<{ id: string; name: string; type: string; purpose: string; service: string | null; url: string | null; notes: string | null }>;
      return JSON.stringify(conns, null, 2);
    },
  });

  registerTool({
    name: 'create_connection',
    description: 'Create a new MCP or GitHub connection. Provide name, type (github | mcp), and config.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: 'github | mcp' },
        purpose: { type: 'string' },
        config: { type: 'object', description: 'Required: command/args/env for mcp, apiKey for github' },
      },
      required: ['name', 'type'],
    },
    handler: async (args, userId) => {
      const executionId = createExecution(userId, null, null, 'create_connection');
      const connType = args.type as string;
      const decision = await requestApproval(executionId, userId, 'create_connection', {
        session_id: undefined,
        ui: {
          kind: 'connection',
          name: args.name as string,
          connectionType: connType,
          description: connType === 'mcp' ? 'Add a new MCP integration' : 'Connect to a GitHub repository',
          command: (args.config as Record<string, unknown> | undefined)?.command as string | undefined,
        },
      }, 'user');
      if (decision.decision === 'rejected') {
        completeExecution(executionId, userId, 'error', 'User rejected connection creation.');
        return 'Cancelled: user did not approve this connection.';
      }
      const result = await createConnectionTool(
        {
          name: args.name as string,
          type: args.type as string,
          purpose: args.purpose as string | undefined,
          config: (args.config as Record<string, unknown>) ?? {},
        },
        { userId, executionId },
      );
      completeExecution(executionId, userId, result.startsWith('Error:') ? 'error' : 'done', result);
      return result;
    },
  });

  registerTool({
    name: 'delete_connection',
    description: 'Delete a connection by id.',
    inputSchema: {
      type: 'object',
      properties: { connection_id: { type: 'string' } },
      required: ['connection_id'],
    },
    handler: async (args, userId) => {
      const row = getDb()
        .prepare('SELECT name FROM connections WHERE id = ? AND user_id = ?')
        .get(args.connection_id as string, userId) as { name: string } | undefined;
      if (!row) return `Error: connection ${args.connection_id} not found`;
      if (row.name.startsWith('tool:')) {
        return 'Error: generated tool package connections must be disabled with disable_tool_package.';
      }
      closeMcpConnection(args.connection_id as string);
      const result = getDb()
        .prepare('DELETE FROM connections WHERE id = ? AND user_id = ?')
        .run(args.connection_id as string, userId);
      return result.changes > 0 ? 'deleted' : `Error: connection ${args.connection_id} not found`;
    },
  });

  registerTool({
    name: 'test_connection',
    description: 'Test a connection and return its status',
    inputSchema: {
      type: 'object',
      properties: { connection_id: { type: 'string' } },
      required: ['connection_id'],
    },
    handler: async (args, userId) => {
      const connRow = getDb()
        .prepare('SELECT id, name, type FROM connections WHERE id = ? AND user_id = ?')
        .get(args.connection_id as string, userId) as { id: string; name: string; type: string } | undefined;
      if (!connRow) return `Error: connection ${args.connection_id} not found`;
      if (connRow.type !== 'mcp') {
        const cfg = getDecryptedConfig(connRow.id, userId);
        const hasKey = Object.values(cfg).some(v => v && String(v).length > 0);
        return JSON.stringify({ id: connRow.id, name: connRow.name, type: connRow.type, status: hasKey ? 'ok' : 'error' });
      }
      try {
        const cfg = getDecryptedConfig(connRow.id, userId);
        const mcpArgs = cfg.args ? (JSON.parse(cfg.args) as string[]) : [];
        const mcpEnv = cfg.env ? (JSON.parse(cfg.env) as Record<string, string>) : {};
        const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv, cfg.cwd);
        return JSON.stringify({
          id: connRow.id,
          name: connRow.name,
          type: 'mcp',
          status: 'ok',
          tools: tools.map(t => ({ name: t.name, description: t.description })),
        });
      } catch (err) {
        return JSON.stringify({
          id: connRow.id,
          name: connRow.name,
          type: 'mcp',
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
