import Anthropic from '@anthropic-ai/sdk';

export interface Intent {
  domain: 'code' | 'writing' | 'research' | 'creative' | 'image' | 'multi' | 'general';
  complexity: 'low' | 'medium' | 'high';
  model: 'haiku' | 'sonnet' | 'fable' | 'opus';
  tools: string[];
  scope: 'inline' | 'delegate' | 'campaign';
  needs_research: boolean;
  ambiguous: boolean;
}

export const DEFAULT_INTENT: Intent = {
  domain: 'general',
  complexity: 'medium',
  model: 'sonnet',
  tools: [],
  scope: 'inline',
  needs_research: false,
  ambiguous: true,
};

const KNOWN_TOOLS = [
  'invoke_claude_code',
  'invoke_codex',
  'github_api',
  'mcp_call',
  'git_op',
  'project_query',
  'rebuild_graph',
  'remember',
  'recall',
  'forget',
  'create_project',
  'update_project',
  'delete_project',
  'read_file',
  'search_files',
  'list_dir',
  'write_file',
  'create_artifact',
  'register_artifact',
  'list_artifacts',
  'read_artifact',
  'list_connections',
  'test_connection',
  'list_chats',
  'read_chat',
  'create_campaign',
  'resume_campaign',
  'list_campaigns',
  'get_campaign',
  'get_execution_output',
  'list_scheduled_tasks',
  'create_scheduled_task',
  'update_scheduled_task',
  'delete_scheduled_task',
  'generate_video',
  'web_search',
  'web_fetch',
];

const INTENT_SYSTEM = `You are a routing classifier. Given a user message, output JSON only — no prose, no markdown.

Return exactly this shape:
{"domain":"code|writing|research|creative|image|multi|general","complexity":"low|medium|high","model":"haiku|sonnet|fable|opus","tools":[],"scope":"inline|delegate|campaign","needs_research":false,"ambiguous":false}

Domain:
- code: coding, debugging, refactoring, software projects
- writing: drafts, docs, essays, emails, specs
- research: questions, lookups, fact-finding, comparisons
- creative: stories, poetry, brainstorming, creative content (non-image)
- image: image generation requests
- multi: clearly spans multiple domains
- general: unclear, conversational, or greeting

Complexity:
- low: quick answer, trivial edit, single file
- medium: a feature, a few files, standard work
- high: architecture, large refactor, multi-system coordination

Model:
- haiku: any low complexity
- sonnet: medium complexity anything
- fable: high complexity creative or writing
- opus: high complexity code, architecture, or deep analysis

Scope:
- inline: respond directly with no tool delegation
- delegate: one coding or creative agent call
- campaign: multiple independent or sequenced tasks

tools: hint at likely tools from:
- agents/code: invoke_claude_code, invoke_codex, git_op, github_api
- project/code context: project_query, rebuild_graph, search_files, read_file, list_dir, write_file
- campaigns: create_campaign, resume_campaign, list_campaigns, get_campaign, get_execution_output
- MCP/connections: list_connections, test_connection, mcp_call
- artifacts: create_artifact, register_artifact, list_artifacts, read_artifact
- memory/chats: remember, recall, forget, list_chats, read_chat
- scheduled work: list_scheduled_tasks, create_scheduled_task, update_scheduled_task, delete_scheduled_task
- research/media: web_search, web_fetch, generate_video

Set ambiguous=true and use general/medium/sonnet/inline defaults when the message is unclear.`;

export async function extractIntentWithClient(userMessage: string, client: Anthropic): Promise<Intent> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: INTENT_SYSTEM,
      messages: [{ role: 'user', content: userMessage.slice(0, 1000) }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    const parsed = JSON.parse(text) as Partial<Intent>;
    return {
      domain: (['code','writing','research','creative','image','multi','general'] as const).includes(parsed.domain as never)
        ? parsed.domain as Intent['domain']
        : DEFAULT_INTENT.domain,
      complexity: (['low','medium','high'] as const).includes(parsed.complexity as never)
        ? parsed.complexity as Intent['complexity']
        : DEFAULT_INTENT.complexity,
      model: (['haiku','sonnet','fable','opus'] as const).includes(parsed.model as never)
        ? parsed.model as Intent['model']
        : DEFAULT_INTENT.model,
      tools: Array.isArray(parsed.tools) ? parsed.tools.filter((t): t is string => typeof t === 'string' && KNOWN_TOOLS.includes(t)) : [],
      scope: (['inline','delegate','campaign'] as const).includes(parsed.scope as never)
        ? parsed.scope as Intent['scope']
        : DEFAULT_INTENT.scope,
      needs_research: typeof parsed.needs_research === 'boolean' ? parsed.needs_research : false,
      ambiguous: typeof parsed.ambiguous === 'boolean' ? parsed.ambiguous : DEFAULT_INTENT.ambiguous,
    };
  } catch {
    return { ...DEFAULT_INTENT };
  }
}

export async function extractIntent(userMessage: string, apiKey: string): Promise<Intent> {
  return extractIntentWithClient(userMessage, new Anthropic({ apiKey }));
}
