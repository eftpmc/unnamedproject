import type Anthropic from '@anthropic-ai/sdk';
import { upsertMcpRegistryTools, getMcpRegistryToolsForUser, getMcpRegistryTool } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { listMcpTools, callMcpTool } from '../lib/mcp-pool.js';

function parseMcpConfig(connectionId: string, cfg: Record<string, string>): { args: string[]; env: Record<string, string> } {
  let args: string[] = [];
  let env: Record<string, string> = {};

  if (cfg.args) {
    try {
      args = JSON.parse(cfg.args);
    } catch (err) {
      throw new Error(
        `Malformed MCP connection config: failed to parse "args" JSON for connection ${connectionId}: ${(err as Error).message}`,
      );
    }
  }

  if (cfg.env) {
    try {
      env = JSON.parse(cfg.env);
    } catch (err) {
      throw new Error(
        `Malformed MCP connection config: failed to parse "env" JSON for connection ${connectionId}: ${(err as Error).message}`,
      );
    }
  }

  return { args, env };
}

export async function ingestMcpTools(userId: string, connectionId: string): Promise<void> {
  const cfg = getDecryptedConfig(connectionId, userId);
  const { args: mcpArgs, env: mcpEnv } = parseMcpConfig(connectionId, cfg);
  const tools = await listMcpTools(connectionId, cfg.command, mcpArgs, mcpEnv);
  upsertMcpRegistryTools(
    userId,
    connectionId,
    tools.map(t => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema })),
  );
}

export function getRegistrySearchPool(userId: string): Array<{ name: string; description: string }> {
  return getMcpRegistryToolsForUser(userId).map(t => ({ name: t.tool_name, description: t.description }));
}

export function resolveRegistryTool(userId: string, toolName: string): Anthropic.Tool | undefined {
  const row = getMcpRegistryTool(userId, toolName);
  if (!row) return undefined;
  return {
    name: row.tool_name,
    description: row.description,
    input_schema: JSON.parse(row.input_schema),
  };
}

export async function dispatchRegistryTool(
  userId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string | undefined> {
  const row = getMcpRegistryTool(userId, toolName);
  if (!row) return undefined;
  const cfg = getDecryptedConfig(row.connection_id, userId);
  const { args: mcpArgs, env: mcpEnv } = parseMcpConfig(row.connection_id, cfg);
  return callMcpTool(row.connection_id, cfg.command, mcpArgs, mcpEnv, row.mcp_tool_name, toolInput);
}
