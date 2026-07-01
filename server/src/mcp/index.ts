import { Router } from 'express';
import { verifyMcpToken } from './auth.js';
import { listTools, getTool } from './registry.js';
import './handlers/index.js';

const router = Router();

router.post('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token' });
    return;
  }

  let userId: string;
  let sessionId: string | null;
  let profile: string | null;
  try {
    ({ userId, sessionId, profile } = verifyMcpToken(authHeader.slice(7)));
  } catch {
    res.status(401).json({ error: 'Invalid MCP token' });
    return;
  }

  const { jsonrpc, method, params, id } = req.body as {
    jsonrpc: string;
    method: string;
    params?: Record<string, unknown>;
    id: number | string;
  };

  function ok(result: unknown) {
    res.json({ jsonrpc, id, result });
  }

  function err(code: number, message: string) {
    res.json({ jsonrpc, id, error: { code, message } });
  }

  if (method === 'initialize') {
    ok({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'app', version: '1.0' },
    });
    return;
  }

  if (method === 'tools/list') {
    ok({
      tools: listTools().map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const tool = getTool(name);
    if (!tool) {
      err(-32601, `Unknown tool: ${name}`);
      return;
    }
    try {
      const text = await tool.handler(args, userId, sessionId, profile);
      ok({ content: [{ type: 'text', text }] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      ok({ content: [{ type: 'text', text: `Error: ${msg}` }], isError: true });
    }
    return;
  }

  err(-32601, `Method not found: ${method}`);
});

export default router;
