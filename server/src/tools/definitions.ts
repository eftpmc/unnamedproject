import type Anthropic from '@anthropic-ai/sdk';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'invoke_claude_code',
    description: 'Spawn Claude Code CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Claude Code' },
      },
      required: ['workspace_id', 'prompt'],
    },
  },
  {
    name: 'invoke_codex',
    description: 'Spawn Codex CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Codex' },
      },
      required: ['workspace_id', 'prompt'],
    },
  },
  {
    name: 'github_api',
    description: 'Read repos, issues, and comments from GitHub. Write ops (comments) require user approval.',
    input_schema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list_repos', 'get_repo', 'list_issues', 'get_issue', 'create_issue_comment'] },
        owner: { type: 'string' },
        repo: { type: 'string' },
        issue_number: { type: 'number' },
        comment_body: { type: 'string' },
      },
      required: ['op'],
    },
  },
  {
    name: 'mcp_call',
    description: 'Call a tool on a configured MCP server.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'ID of the MCP connection to use' },
        tool_name: { type: 'string', description: 'Name of the MCP tool to call' },
        tool_input: { type: 'object', description: 'Input for the MCP tool', additionalProperties: true },
      },
      required: ['connection_id', 'tool_name', 'tool_input'],
    },
  },
  {
    name: 'git_op',
    description: 'Run git operations in a workspace repo. Write ops (commit, push) require user approval.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: 'Branch name (for push op)' },
      },
      required: ['workspace_id', 'op'],
    },
  },
  {
    name: 'workspace_query',
    description: 'Query the Graphify knowledge graph for a workspace to understand its code structure without reading raw files.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['workspace_id', 'question'],
    },
  },
  {
    name: 'remember',
    description: 'Store a fact about the user for future sessions.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short identifier for the fact' },
        value: { type: 'string', description: 'The fact to remember' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'recall',
    description: 'Read stored facts about the user. Pass a key to get one fact, or omit key to get all.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to look up (optional — omit to get all)' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in a workspace repo.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
      },
      required: ['workspace_id', 'path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory in a workspace repo.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root (default: repo root)' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in a workspace repo, creating it if needed. Requires approval.',
    input_schema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
        content: { type: 'string', description: 'New file contents' },
      },
      required: ['workspace_id', 'path', 'content'],
    },
  },
  {
    type: 'web_search_20250305',
    name: 'web_search',
  } as unknown as Anthropic.Tool,
];
