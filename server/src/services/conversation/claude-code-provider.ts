import { invokeClaudeCode } from '../../tools/invoke_claude_code.js';
import { createExecution, completeExecution } from '../executor.js';
import { normalizePermissionProfile } from '../permissions.js';
import type { McpServerConfig } from '../../tools/invoke_claude_code.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface ClaudeCodeConfig {
  model: string;
  permissionProfile: string;
}

export class ClaudeCodeProvider implements ConversationProvider {
  readonly type = 'claude_code' as const;
  private config: ClaudeCodeConfig;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
  }

  async invoke(params: InvokeParams): Promise<{ costUsd?: number }> {
    const userId = params.userId ?? 'system';
    const executionId = createExecution(userId, null, null, 'claude_code');
    try {
      const result = await invokeClaudeCode(
        { prompt: params.prompt, model: this.config.model },
        {
          userId,
          executionId,
          resumeSessionId: params.resumeSessionId,
          mcpServers: params.mcpServers as Record<string, McpServerConfig>,
          permissionProfile: normalizePermissionProfile(this.config.permissionProfile),
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
