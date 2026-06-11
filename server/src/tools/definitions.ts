import type Anthropic from '@anthropic-ai/sdk';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'invoke_claude_code',
    description: 'Spawn Claude Code CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Claude Code' },
      },
      required: ['project_id', 'prompt'],
    },
  },
  {
    name: 'invoke_codex',
    description: 'Spawn Codex CLI in a workspace repo to write, edit, or analyze code.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the workspace to work in' },
        prompt: { type: 'string', description: 'The task to give Codex' },
      },
      required: ['project_id', 'prompt'],
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
        project_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: 'Branch name (for push op)' },
      },
      required: ['project_id', 'op'],
    },
  },
  {
    name: 'project_query',
    description: 'Query the Graphify knowledge graph for a project to understand its code structure without reading raw files.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['project_id', 'question'],
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
    name: 'create_project',
    description: 'Create a new project. If with_repo is true, creates a git repo under the configured projects root.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Optional description' },
        with_repo: { type: 'boolean', description: 'Whether to create a backing git repo for this project' },
      },
      required: ['name', 'with_repo'],
    },
  },
  {
    name: 'update_project',
    description: "Update a project's description.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['project_id', 'description'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a project. Requires user approval. Optionally deletes the project files on disk.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        delete_files: { type: 'boolean', description: 'Whether to also delete the project repo directory from disk' },
      },
      required: ['project_id', 'delete_files'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file in a workspace repo.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
      },
      required: ['project_id', 'path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory in a workspace repo.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root (default: repo root)' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in a workspace repo, creating it if needed. Requires approval.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
        content: { type: 'string', description: 'New file contents' },
      },
      required: ['project_id', 'path', 'content'],
    },
  },
  {
    type: 'web_search_20250305',
    name: 'web_search',
  } as unknown as Anthropic.Tool,
];
