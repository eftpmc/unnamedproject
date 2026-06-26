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
  effort?: string;
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onSessionId: (id: string) => void;
}

export interface ConversationProvider {
  readonly type: 'claude_code' | 'codex';
  invoke(params: InvokeParams): Promise<{ costUsd?: number }>;
  resolveModel(): Promise<string>;
}

function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('usage limit') ||
    msg.includes('quota') ||
    msg.includes('limit exceeded') ||
    msg.includes('too many requests') ||
    msg.includes('429')
  );
}

class FallbackProvider implements ConversationProvider {
  private _type: 'claude_code' | 'codex';
  get type(): 'claude_code' | 'codex' { return this._type; }
  private providers: ConversationProvider[];

  constructor(providers: ConversationProvider[]) {
    this.providers = providers;
    this._type = providers[0].type;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    let lastError: Error | undefined;
    for (const provider of this.providers) {
      try {
        const result = await provider.invoke(params);
        this._type = provider.type;
        return result;
      } catch (err) {
        if (isRateLimitError(err)) {
          lastError = err instanceof Error ? err : new Error(String(err));
          continue;
        }
        throw err;
      }
    }
    throw lastError!;
  }

  async resolveModel(): Promise<string> {
    return this.providers[0].resolveModel();
  }
}

export async function getConversationProvider(userId: string): Promise<ConversationProvider> {
  const conns = getDb()
    .prepare("SELECT id, type FROM connections WHERE user_id = ? AND type IN ('claude_code','codex') ORDER BY created_at")
    .all(userId) as { id: string; type: string }[];

  const providers: ConversationProvider[] = [];
  for (const conn of conns) {
    const cfg = getDecryptedConfig(conn.id, userId);
    const model = cfg.model as string | undefined;
    const permissionProfile = (cfg.permissionProfile as string) ?? 'default';

    if (conn.type === 'codex') {
      const { CodexProvider } = await import('./conversation/codex-provider.js');
      providers.push(new CodexProvider({ model: model ?? 'codex-mini-latest', permissionProfile }));
    } else {
      providers.push(new ClaudeCodeProvider({ model: model ?? 'claude-sonnet-4-6', permissionProfile }));
    }
  }

  if (providers.length === 0) {
    return new ClaudeCodeProvider({ model: 'claude-sonnet-4-6', permissionProfile: 'default' });
  }

  if (providers.length === 1) return providers[0];
  return new FallbackProvider(providers);
}
