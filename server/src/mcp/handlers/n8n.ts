import { registerTool } from '../registry.js';
import { getDb } from '../../db/index.js';
import { decrypt, deriveKey } from '../../lib/crypto.js';

export function registerN8nHandlers(): void {
  registerTool({
    name: 'call_n8n_workflow',
    description: 'Trigger an n8n workflow via its webhook URL and return the response. Use connection_id from list_connections (type: n8n).',
    inputSchema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'ID of an n8n connection' },
        workflow_id: { type: 'string', description: 'n8n workflow ID or webhook path' },
        payload: { type: 'object', description: 'JSON payload to send to the workflow' },
      },
      required: ['connection_id', 'workflow_id'],
    },
    handler: async (args, userId) => {
      const row = getDb()
        .prepare('SELECT type, encrypted_config FROM connections WHERE id = ? AND user_id = ?')
        .get(args.connection_id as string, userId) as { type: string; encrypted_config: string } | undefined;
      if (!row) return `Error: connection ${args.connection_id} not found`;
      if (row.type !== 'n8n') return `Error: connection is type '${row.type}', expected 'n8n'`;

      const config = JSON.parse(decrypt(row.encrypted_config, deriveKey())) as Record<string, string>;
      const baseUrl = config.baseUrl?.replace(/\/$/, '');
      if (!baseUrl) return 'Error: n8n connection missing baseUrl';

      const url = `${baseUrl}/webhook/${args.workflow_id as string}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['X-N8N-API-KEY'] = config.apiKey;

      try {
        const r = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(args.payload ?? {}),
        });
        const text = await r.text();
        if (!r.ok) return `Error: n8n returned HTTP ${r.status}: ${text}`;
        try { return JSON.stringify(JSON.parse(text), null, 2); }
        catch { return text; }
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
  });
}
