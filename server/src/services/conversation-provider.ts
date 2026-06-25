import { getDb } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';
import { ClaudeCodeProvider } from './conversation/claude-code-provider.js';

export interface InvokeParams {
  userId?: string;
  prompt: string;
  resumeSessionId?: string | null;
  systemPromptSuffix?: string;
  mcpServers: Record<string, { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> }>;
  model?: string;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onSessionId: (id: string) => void;
}

export interface ConversationProvider {
  readonly type: 'claude_code' | 'codex';
  invoke(params: InvokeParams): Promise<{ costUsd?: number }>;
  resolveModel(): Promise<string>;
}

export async function getConversationProvider(userId: string): Promise<ConversationProvider> {
  const conn = getDb()
    .prepare("SELECT id, type FROM connections WHERE user_id = ? AND type IN ('claude_code','codex') ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string; type: string } | undefined;

  if (conn) {
    const cfg = getDecryptedConfig(conn.id, userId);
    const mode = (cfg.mode as 'local' | 'api') ?? 'local';
    const model = cfg.model as string | undefined;
    const permissionProfile = (cfg.permissionProfile as string) ?? 'default';
    const apiKey = cfg.apiKey as string | undefined;

    if (conn.type === 'codex') {
      const { CodexProvider } = await import('./conversation/codex-provider.js');
      return new CodexProvider({ mode, model: model ?? 'codex-mini-latest', permissionProfile, apiKey });
    }
    return new ClaudeCodeProvider({ mode, model: model ?? 'claude-sonnet-4-6', permissionProfile, apiKey });
  }

  // Default: local Claude Code CLI
  return new ClaudeCodeProvider({ mode: 'local', model: 'claude-sonnet-4-6', permissionProfile: 'default' });
}
