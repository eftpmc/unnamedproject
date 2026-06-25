import { invokeCodex } from '../../tools/invoke_codex.js';
import { createExecution, completeExecution } from '../executor.js';
import { newId } from '../../lib/ids.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface CodexConfig {
  mode: 'local' | 'api';
  model: string;
  permissionProfile: string;
  apiKey?: string;
}

export class CodexProvider implements ConversationProvider {
  readonly type = 'codex' as const;
  private config: CodexConfig;

  constructor(config: CodexConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const executionId = createExecution(params.userId ?? 'system', newId(), null, 'codex');
    const result = await invokeCodex(
      { prompt: params.prompt, model: this.config.model },
      {
        userId: params.userId ?? 'system',
        executionId,
        apiKey: this.config.apiKey ?? null,
        resumeSessionId: params.resumeSessionId,
        mcpServers: params.mcpServers as Record<string, { command: string; args?: string[]; env?: Record<string, string> }>,
        permissionProfile: this.config.permissionProfile as 'default' | 'fast' | 'strict',
        signal: params.signal,
        onText: params.onText,
        onSessionId: params.onSessionId,
      },
    );
    completeExecution(executionId, params.userId ?? 'system', 'done', result.result);
    return { costUsd: result.costUsd };
  }

  async resolveModel(): Promise<string> {
    return this.config.model;
  }
}
