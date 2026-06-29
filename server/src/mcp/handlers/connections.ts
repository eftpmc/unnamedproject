import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { getDecryptedConfig } from '../../routes/connections.js';
import { createConnectionTool } from '../../tools/connection_ops.js';
import { listMcpTools } from '../../lib/mcp-pool.js';
import { createExecution, completeExecution } from '../../services/executor.js';

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
    description: 'Create a new connection. For web connections (type=web): provide name, service (e.g. "linkedin"), url, and optional notes. For MCP/github: provide config.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: 'github | mcp | web' },
        purpose: { type: 'string' },
        config: { type: 'object', description: 'Required for github/mcp types' },
        service: { type: 'string', description: 'Service slug for web type (e.g. linkedin, gmail, handshake)' },
        url: { type: 'string', description: 'URL for web connections' },
        notes: { type: 'string', description: 'Context notes for the agent (navigation hints, account details, etc.)' },
      },
      required: ['name', 'type'],
    },
    handler: async (args, userId) => {
      const executionId = createExecution(userId, null, null, 'create_connection');
      const result = await createConnectionTool(
        {
          name: args.name as string,
          type: args.type as string,
          purpose: args.purpose as string | undefined,
          config: (args.config as Record<string, unknown>) ?? {},
          service: args.service as string | undefined,
          url: args.url as string | undefined,
          notes: args.notes as string | undefined,
        },
        { userId, executionId },
      );
      completeExecution(executionId, userId, result.startsWith('Error:') ? 'error' : 'done', result);
      return result;
    },
  });

  registerTool({
    name: 'update_connection',
    description: 'Update a web connection\'s name, service, url, or notes. Only works on type=web connections.',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string' },
        name: { type: 'string' },
        service: { type: 'string' },
        url: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['connection_id'],
    },
    handler: async (args, userId) => {
      const row = getDb()
        .prepare("SELECT id FROM connections WHERE id = ? AND user_id = ? AND type = 'web'")
        .get(args.connection_id as string, userId);
      if (!row) return `Error: web connection ${args.connection_id} not found`;
      const sets: string[] = [];
      const vals: unknown[] = [];
      if (args.name !== undefined) { sets.push('name = ?'); vals.push(args.name); }
      if (args.service !== undefined) { sets.push('service = ?'); vals.push(args.service || null); }
      if (args.url !== undefined) { sets.push('url = ?'); vals.push(args.url || null); }
      if (args.notes !== undefined) { sets.push('notes = ?'); vals.push(args.notes || null); }
      if (!sets.length) return 'Error: nothing to update';
      try {
        getDb().prepare(`UPDATE connections SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...vals, args.connection_id as string, userId);
      } catch {
        return 'Error: connection name already exists';
      }
      return 'updated';
    },
  });

  registerTool({
    name: 'delete_connection',
    description: 'Delete a connection by id. Works for web connections; also removes MCP connections.',
    inputSchema: {
      type: 'object',
      properties: { connection_id: { type: 'string' } },
      required: ['connection_id'],
    },
    handler: async (args, userId) => {
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
        const tools = await listMcpTools(connRow.id, cfg.command, mcpArgs, mcpEnv);
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
