import { invokeCodex } from '../../tools/invoke_codex.js';
import { createExecution, completeExecution } from '../executor.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface CodexConfig {
  model: string;
  permissionProfile: string;
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
        { prompt: params.prompt, model: this.config.model },
        {
          userId,
          executionId,
          resumeSessionId: params.resumeSessionId,
          mcpServers: params.mcpServers,
          permissionProfile: this.config.permissionProfile as 'default' | 'fast' | 'strict',
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
    return this.config.model;
  }
}
