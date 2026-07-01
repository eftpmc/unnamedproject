import { getDb, getPermissionProfile } from '../db/index.js';
import { getDecryptedProviderConfig } from '../routes/agent-providers.js';
import { ClaudeCodeProvider } from './conversation/claude-code-provider.js';

export interface InvokeParams {
  userId?: string;
  messageId?: string | null;
  repoPath?: string;
  prompt: string;
  resumeSessionId?: string | null;
  systemPromptSuffix?: string;
  mcpServers: Record<string, { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string> }>;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onSessionId: (id: string) => void;
}

export interface ConversationProvider {
  readonly type: 'claude_code';
  invoke(params: InvokeParams): Promise<{ costUsd?: number; executionId?: string }>;
  resolveModel(): Promise<string>;
}

export async function getConversationProvider(userId: string): Promise<ConversationProvider> {
  const conn = getDb()
    .prepare("SELECT id FROM agent_providers WHERE user_id = ? AND type = 'claude_code' ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string } | undefined;

  if (conn) {
    const cfg = getDecryptedProviderConfig(conn.id, userId);
    const permissionProfile = cfg.permissionProfile === 'default' || cfg.permissionProfile === undefined
      ? getPermissionProfile(userId)
      : cfg.permissionProfile as string;
    return new ClaudeCodeProvider({
      model: (cfg.model as string | undefined) ?? 'claude-sonnet-4-6',
      permissionProfile,
      apiKey: cfg.apiKey as string | undefined,
    });
  }

  return new ClaudeCodeProvider({ model: 'claude-sonnet-4-6', permissionProfile: getPermissionProfile(userId) });
}
