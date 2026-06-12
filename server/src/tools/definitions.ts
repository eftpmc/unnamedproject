import type Anthropic from '@anthropic-ai/sdk';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'invoke_claude_code',
    description: `Dispatch Claude Code — a fully autonomous AI coding agent — to work inside the project repo. Claude Code can handle entire features end-to-end: it reads the codebase, plans changes, writes and edits files across multiple modules, runs tests and fixes failures, installs dependencies, sets up frameworks, refactors, debugs complex issues, and more. It operates in an isolated worktree so it never touches the main branch. Use this for any non-trivial coding task — don't limit it to small edits. Write rich, detailed prompts: describe what you want built, the context it fits into, relevant constraints, and what "done" looks like. Claude Code maintains conversation context across calls on the same session, so you can follow up, course-correct, or ask it to continue. Claude Code can run with an Anthropic API key from the user's connections, or locally if the claude CLI is already installed and authenticated on the machine — no connection required in that case.`,
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project to work in' },
        prompt: { type: 'string', description: 'The task to give Claude Code. Be specific and thorough — it can handle complex, multi-file work. Include context, constraints, and what done looks like.' },
        model: { type: 'string', description: "Optional model override for this run, e.g. 'sonnet', 'opus', 'haiku', 'fable', or a full model ID. Defaults to the CLI's configured default." },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
      },
      required: ['project_id', 'prompt'],
    },
  },
  {
    name: 'invoke_codex',
    description: `Dispatch Codex — OpenAI's autonomous coding agent — to work inside the project repo. Like Claude Code, Codex can implement features, write and edit files, run commands, fix tests, and reason about a codebase. It operates in the same isolated worktree. Use Codex when the user prefers OpenAI models, or in parallel with Claude Code to get a second implementation or approach. Write detailed prompts — Codex performs best with clear context about the codebase, the goal, and expected output. Codex can run with an OpenAI API key from the user's connections, or locally if the codex CLI is already installed and authenticated on the machine — no connection required in that case.`,
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project to work in' },
        prompt: { type: 'string', description: 'The task to give Codex. Be specific — include codebase context, what to build, and what done looks like.' },
        model: { type: 'string', description: "Optional OpenAI model override for this run, e.g. 'gpt-5'. Defaults to the CLI's configured default." },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
      },
      required: ['project_id', 'prompt'],
    },
  },
  {
    name: 'github_api',
    description: 'Interact with GitHub repos, issues, and pull requests. Write ops (create_issue, create_pull_request, create_issue_comment) require user approval.',
    input_schema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list_repos', 'get_repo', 'list_issues', 'get_issue', 'create_issue', 'create_issue_comment', 'list_pull_requests', 'get_pull_request', 'create_pull_request'] },
        owner: { type: 'string', description: 'Repo owner (user or org)' },
        repo: { type: 'string', description: 'Repo name' },
        issue_number: { type: 'number', description: 'Issue number (for get_issue, create_issue_comment)' },
        pr_number: { type: 'number', description: 'PR number (for get_pull_request)' },
        title: { type: 'string', description: 'Title (for create_issue, create_pull_request)' },
        body: { type: 'string', description: 'Body text (for create_issue, create_pull_request)' },
        head: { type: 'string', description: 'Source branch (for create_pull_request)' },
        base: { type: 'string', description: 'Target branch (for create_pull_request, defaults to main)' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels (for create_issue)' },
        comment_body: { type: 'string', description: 'Comment text (for create_issue_comment)' },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
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
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
      },
      required: ['connection_id', 'tool_name', 'tool_input'],
    },
  },
  {
    name: 'git_op',
    description: "Run git operations in this session's isolated agent worktree. To commit: run add first (stages everything), then commit. Push sends the session branch for PR review. Status and diff are useful for summarizing what changed.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'add', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: "Branch name to push (for push op, defaults to this session's agent branch)" },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
      },
      required: ['project_id', 'op'],
    },
  },
  {
    name: 'project_query',
    description: 'Ask a question about a project codebase (structure, where something is implemented, how things connect). Queries a pre-built knowledge graph — fast and token-efficient. The graph is rebuilt automatically after invoke_claude_code/invoke_codex finish, so it should already reflect recent changes; call rebuild_graph manually only if you suspect it is stale (e.g. after manual write_file edits).',
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
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a project. Call this after significant code changes (e.g. after a Claude Code or Codex session) so that subsequent project_query calls reflect the current state of the codebase.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
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
    description: "Create a new project. If with_repo is true, creates a git repo under the configured projects root. type is one of 'default' or 'video' (defaults to 'default').",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Optional description' },
        with_repo: { type: 'boolean', description: 'Whether to create a backing git repo for this project' },
        type: { type: 'string', description: "Project type, one of: 'default', 'video'. Defaults to 'default'." },
      },
      required: ['name', 'with_repo'],
    },
  },
  {
    name: 'update_project',
    description: "Update a project's description and/or type.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string', description: "Project type, one of: 'default', 'video'." },
      },
      required: ['project_id'],
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
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this execution to (from create_campaign response)' },
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
    name: 'create_campaign',
    description: 'Create a campaign to track a coordinated multi-task plan. Call this BEFORE dispatching the individual tasks. The response includes task IDs — pass each task\'s id as campaign_task_id when calling invoke_claude_code, invoke_codex, mcp_call, write_file, git_op, or github_api so the tasks are linked and their status tracked. Task agent types: claude_code/codex/mcp for delegated agent work, file_write for a write_file step, git for a git_op step (e.g. a commit after coding tasks), github for a github_api step (e.g. opening the final PR).',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project this campaign belongs to' },
        title: { type: 'string', description: 'Short name for the campaign, e.g. "Auth refactor"' },
        tasks: {
          type: 'array',
          description: 'Ordered list of planned tasks',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              agent: { type: 'string', enum: ['claude_code', 'codex', 'mcp', 'file_write', 'git', 'github'] },
            },
            required: ['title', 'agent'],
          },
        },
      },
      required: ['project_id', 'title', 'tasks'],
    },
  },
  {
    type: 'web_search_20250305',
    name: 'web_search',
  } as unknown as Anthropic.Tool,
  {
    type: 'web_fetch_20250910',
    name: 'web_fetch',
    max_uses: 5,
  } as unknown as Anthropic.Tool,
];
