import { invokeClaudeCode } from '../../tools/invoke_claude_code.js';
import { createExecution, completeExecution } from '../executor.js';
import { normalizePermissionProfile } from '../permissions.js';
import type { McpServerConfig } from '../../tools/invoke_claude_code.js';
import type { ConversationProvider, InvokeParams } from '../conversation-provider.js';

interface ClaudeCodeConfig {
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

  async invoke(params: InvokeParams): Promise<{ costUsd?: number; executionId?: string }> {
    const userId = params.userId ?? 'system';
    const executionId = createExecution(userId, params.messageId ?? null, null, 'claude_code');
    try {
      const result = await invokeClaudeCode(
        { prompt: params.prompt, model: params.model ?? this.config.model },
        {
          userId,
          executionId,
          repoPath: params.repoPath,
          resumeSessionId: params.resumeSessionId,
          mcpServers: params.mcpServers as Record<string, McpServerConfig>,
          permissionProfile: normalizePermissionProfile(this.config.permissionProfile),
          apiKey: this.config.apiKey,
          effort: params.effort,
          timeoutMs: params.timeoutMs,
          systemPromptSuffix: params.systemPromptSuffix,
          signal: params.signal,
          onText: params.onText,
          onSessionId: params.onSessionId,
        },
      );
      completeExecution(executionId, userId, 'done', result.result);
      return { costUsd: result.costUsd, executionId };
    } catch (err) {
      completeExecution(executionId, userId, 'error', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async resolveModel(): Promise<string> {
    return this.config.model;
  }
}
