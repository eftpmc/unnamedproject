import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { getDecryptedConfig } from '../../routes/connections.js';
import { createConnectionTool } from '../../tools/connection_ops.js';
import { listMcpTools } from '../../lib/mcp-pool.js';
import { ingestMcpTools } from '../../services/toolRegistry.js';
import { createExecution, completeExecution } from '../../services/executor.js';

export function registerConnectionHandlers(): void {
  registerTool({
    name: 'list_connections',
    description: 'List all configured connections',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_args, userId) => {
      const conns = getDb()
        .prepare('SELECT id, name, type, purpose FROM connections WHERE user_id = ? ORDER BY created_at')
        .all(userId) as Array<{ id: string; name: string; type: string; purpose: string }>;
      return JSON.stringify(conns, null, 2);
    },
  });

  registerTool({
    name: 'create_connection',
    description: 'Create a new connection (anthropic, openai, mcp, claude_code, codex, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string' },
        purpose: { type: 'string' },
        config: { type: 'object' },
      },
      required: ['name', 'type', 'config'],
    },
    handler: async (args, userId) => {
      const executionId = createExecution(userId, null, null, 'create_connection');
      const result = await createConnectionTool(
        {
          name: args.name as string,
          type: args.type as string,
          purpose: args.purpose as string | undefined,
          config: args.config as Record<string, unknown>,
        },
        { userId, executionId },
      );
      completeExecution(executionId, userId, result.startsWith('Error:') ? 'error' : 'done', result);
      return result;
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
        const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv);
        await ingestMcpTools(userId, connRow.id);
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
