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
    description: "Run git operations in this session's isolated agent worktree (its own branch off the project's default branch). Write ops (commit, push) require user approval. Push defaults to this session's branch so changes can be reviewed via a PR before merging.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: "Branch name to push (for push op, defaults to this session's agent branch)" },
      },
      required: ['project_id', 'op'],
    },
  },
  {
    name: 'project_query',
    description: 'Ask a read-only question about a workspace codebase (structure, where something is implemented, how something works). Runs Claude Code in plan mode — it can explore files but cannot make edits.',
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
    description: "Store or update a memory entry. Use 'user' for durable facts/preferences about the user or their environment, 'feedback' for corrections or process preferences about how you should work, 'project' for notes tied to a specific project (pass project_id), and 'reference' for pointers to external systems.",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Category of memory' },
        key: { type: 'string', description: 'Short identifier for the entry' },
        value: { type: 'string', description: 'The fact or note to remember' },
        project_id: { type: 'string', description: "Required when type is 'project' — the project this note relates to" },
      },
      required: ['type', 'key', 'value'],
    },
  },
  {
    name: 'recall',
    description: 'Read stored memory entries. Omit type and key to get everything (grouped by type). Pass type to filter by category, and type+key to get a single entry.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'], description: 'Category to filter by (optional)' },
        key: { type: 'string', description: 'Key to look up (optional — requires type)' },
      },
    },
  },
  {
    name: 'forget',
    description: 'Delete a memory entry by type and key.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['user', 'feedback', 'project', 'reference'] },
        key: { type: 'string' },
      },
      required: ['type', 'key'],
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
    name: 'read_chat',
    description: 'Retrieve messages from a previous chat. Use when the user references past work, asks to continue something, or you need context before responding.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'ID of the chat to read — get IDs from the recent chats list in your context' },
      },
      required: ['chat_id'],
    },
  },
  {
    type: 'web_search_20250305',
    name: 'web_search',
  } as unknown as Anthropic.Tool,
];
