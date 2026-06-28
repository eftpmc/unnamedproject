import { invokeCodex } from '../../tools/invoke_codex.js';
import { createExecution, completeExecution } from '../executor.js';
import { normalizePermissionProfile } from '../permissions.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface CodexConfig {
  model?: string;
  permissionProfile: string;
}

const UNSUPPORTED_CHATGPT_ACCOUNT_MODELS = new Set(['codex-mini-latest']);

function resolveCodexModel(model?: string): string | undefined {
  const normalized = model?.trim();
  if (!normalized || UNSUPPORTED_CHATGPT_ACCOUNT_MODELS.has(normalized)) return undefined;
  return normalized;
}

export class CodexProvider implements ConversationProvider {
  readonly type = 'codex' as const;
  private config: CodexConfig;

  constructor(config: CodexConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const userId = params.userId ?? 'system';
    const executionId = createExecution(userId, null, null, 'codex');
    try {
      const result = await invokeCodex(
        { prompt: params.prompt, model: resolveCodexModel(this.config.model) },
        {
          userId,
          executionId,
          resumeSessionId: params.resumeSessionId,
          mcpServers: params.mcpServers,
          permissionProfile: normalizePermissionProfile(this.config.permissionProfile),
          effort: params.effort,
          systemPromptSuffix: params.systemPromptSuffix,
          signal: params.signal,
          onText: params.onText,
          onSessionId: params.onSessionId,
        },
      );
      completeExecution(executionId, userId, 'done', result.result);
      return { costUsd: result.costUsd };
    } catch (err) {
      completeExecution(executionId, userId, 'error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async resolveModel(): Promise<string> {
    return resolveCodexModel(this.config.model) ?? 'Codex default';
  }
}
