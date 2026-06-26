export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, userId: string, sessionId: string | null) => Promise<string>;
}

const tools = new Map<string, McpToolDef>();

export function registerTool(tool: McpToolDef): void {
  tools.set(tool.name, tool);
}

export function listTools(): McpToolDef[] {
  return Array.from(tools.values());
}

export function getTool(name: string): McpToolDef | undefined {
  return tools.get(name);
}
