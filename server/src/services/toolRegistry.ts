import type Anthropic from '@anthropic-ai/sdk';
import { upsertMcpRegistryTools, getMcpRegistryToolsForUser, getMcpRegistryTool } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { listMcpTools, callMcpTool } from '../lib/mcp-pool.js';

export async function ingestMcpTools(userId: string, connectionId: string): Promise<void> {
  const cfg = getDecryptedConfig(connectionId, userId);
  const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
  const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
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
  const mcpArgs = cfg.args ? JSON.parse(cfg.args) : [];
  const mcpEnv = cfg.env ? JSON.parse(cfg.env) : {};
  return callMcpTool(row.connection_id, cfg.command, mcpArgs, mcpEnv, row.mcp_tool_name, toolInput);
}
