import { invokeClaudeCode } from '../../tools/invoke_claude_code.js';
import { createExecution, completeExecution } from '../executor.js';
import { newId } from '../../lib/ids.js';
import { normalizePermissionProfile } from '../permissions.js';
import type { McpServerConfig } from '../../tools/invoke_claude_code.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface ClaudeCodeConfig {
  mode: 'local' | 'api';
  model: string;
  permissionProfile: string;
  apiKey?: string;
}

export class ClaudeCodeProvider implements ConversationProvider {
  readonly type = 'claude_code' as const;
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const executionId = createExecution(params.userId ?? 'system', newId(), null, 'claude_code');
    const result = await invokeClaudeCode(
      { prompt: params.prompt, model: this.config.model },
      {
        userId: params.userId ?? 'system',
        executionId,
        apiKey: this.config.apiKey ?? null,
        resumeSessionId: params.resumeSessionId,
        mcpServers: params.mcpServers as Record<string, McpServerConfig>,
        permissionProfile: normalizePermissionProfile(this.config.permissionProfile),
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
