import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { EffortLevel } from './anthropic.js';
import { getLeadAgentConnection, resolveModelForTurn } from './anthropic.js';

interface StreamParams {
  model: string;
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}

interface StreamResult {
  contentBlocks: Anthropic.ContentBlock[];
  inputTokens: number;
  outputTokens: number;
}

interface LeadAgentProvider {
  stream(params: StreamParams): Promise<StreamResult>;
  resolveModel(
    session: { model: string | null } | undefined,
    intent: { model: string },
    effort: EffortLevel,
  ): Promise<string>;
}

function toOpenAITools(tools: Anthropic.Tool[]): OpenAI.Chat.ChatCompletionTool[] {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
}

function stringifyToolResultContent(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(block => {
      if (block.type === 'text') return block.text;
      return '';
    })
    .join('');
}

function toOpenAIMessages(
  messages: Anthropic.MessageParam[],
  system: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
  ];

  for (const message of messages) {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        result.push({ role: 'user', content: message.content });
        continue;
      }

      const textBlocks = message.content.filter((block): block is Anthropic.TextBlockParam => block.type === 'text');
      const toolResultBlocks = message.content.filter((block): block is Anthropic.ToolResultBlockParam => block.type === 'tool_result');

      if (textBlocks.length > 0) {
        result.push({ role: 'user', content: textBlocks.map(block => block.text).join('\n') });
      }

      for (const toolResult of toolResultBlocks) {
        result.push({
          role: 'tool',
          tool_call_id: toolResult.tool_use_id,
          content: stringifyToolResultContent(toolResult.content),
        });
      }
      continue;
    }

    if (typeof message.content === 'string') {
      result.push({ role: 'assistant', content: message.content });
      continue;
    }

    const textBlocks = message.content.filter((block): block is Anthropic.TextBlockParam => block.type === 'text');
    const toolUseBlocks = message.content.filter((block): block is Anthropic.ToolUseBlockParam => block.type === 'tool_use');
    const assistantMessage: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: textBlocks.length > 0 ? textBlocks.map(block => block.text).join('\n') : null,
    };

    if (toolUseBlocks.length > 0) {
      assistantMessage.tool_calls = toolUseBlocks.map(block => ({
        id: block.id,
        type: 'function' as const,
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      }));
    }

    result.push(assistantMessage);
  }

  return result;
}

class AnthropicProvider implements LeadAgentProvider {
  private client: Anthropic;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new Anthropic({ apiKey });
  }

  async resolveModel(
    session: { model: string | null } | undefined,
    intent: { model: string },
    effort: EffortLevel,
  ): Promise<string> {
    return session?.model ?? resolveModelForTurn(this.client, intent, effort, this.apiKey);
  }

  async stream({ model, system, tools, messages, signal, onText }: StreamParams): Promise<StreamResult> {
    const stream = this.client.messages.stream(
      { model, max_tokens: 8192, system, tools, messages },
      { headers: { 'anthropic-beta': 'web-fetch-2025-09-10' }, signal },
    );

    stream.on('text', onText);
    const response = await stream.finalMessage();

    return {
      contentBlocks: response.content as Anthropic.ContentBlock[],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

class OpenAICompatibleProvider implements LeadAgentProvider {
  private client: OpenAI;
  private configuredModel: string;

  constructor(apiKey: string, configuredModel: string, baseURL?: string) {
    this.configuredModel = configuredModel;
    this.client = new OpenAI({ apiKey: apiKey || 'local', baseURL });
  }

  async resolveModel(session: { model: string | null } | undefined): Promise<string> {
    return session?.model ?? this.configuredModel;
  }

  async stream({ model, system, tools, messages, signal, onText }: StreamParams): Promise<StreamResult> {
    const stream = this.client.chat.completions.stream(
      {
        model,
        max_tokens: 8192,
        messages: toOpenAIMessages(messages, system),
        ...(tools.length > 0 ? { tools: toOpenAITools(tools) } : {}),
      },
      { signal },
    );

    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) onText(delta.content);

      for (const toolCall of delta?.tool_calls ?? []) {
        const current = toolCalls.get(toolCall.index) ?? { id: '', name: '', arguments: '' };
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.function?.name) current.name = toolCall.function.name;
        if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
        toolCalls.set(toolCall.index, current);
      }
    }

    const completion = await stream.finalChatCompletion();
    const message = completion.choices[0]?.message;
    const contentBlocks: Anthropic.ContentBlock[] = [];
    const text = typeof message?.content === 'string' ? message.content : '';

    if (text) {
      contentBlocks.push({ type: 'text', text, citations: null });
    }

    for (const toolCall of toolCalls.values()) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>;
      } catch {
        input = {};
      }

      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input,
      });
    }

    return {
      contentBlocks,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    };
  }
}

export type { LeadAgentProvider };

export function getLeadAgentProvider(userId: string): LeadAgentProvider {
  try {
    const connection = getLeadAgentConnection(userId);
    if (connection.type === 'openai') return new OpenAICompatibleProvider(connection.apiKey, connection.modelName);
    if (connection.type === 'local') return new OpenAICompatibleProvider(connection.apiKey ?? '', connection.modelName, connection.baseUrl);
    return new AnthropicProvider(connection.apiKey);
  } catch (err) {
    if (process.env.ANTHROPIC_API_KEY) return new AnthropicProvider(process.env.ANTHROPIC_API_KEY);
    throw err;
  }
}
