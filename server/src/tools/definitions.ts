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
    description: "Create a new project. If with_repo is true, creates a git repo under the configured projects root.",
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
    description: "Update a project's name, description, or repo path.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string', description: 'New project name' },
        description: { type: 'string', description: 'New description' },
        repo_path: { type: 'string', description: 'New absolute path to the git repo, or null to unlink' },
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
    description: 'Read a file in a workspace repo. For large files, use offset and limit to page through — offset is the 1-based starting line number, limit is the number of lines to return.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
        offset: { type: 'number', description: 'First line to return (1-based). Omit to start from the beginning.' },
        limit: { type: 'number', description: 'Number of lines to return. Omit to return to the end of file.' },
      },
      required: ['project_id', 'path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern across files in a project. Returns matching lines with file path and line number. Pattern is a JavaScript regex. Use file_glob to filter by filename (e.g. "*.ts"). Faster than reading files one by one for locating symbols, usages, or strings.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default: repo root)' },
        file_glob: { type: 'string', description: 'Filename pattern to restrict search (e.g. "*.ts", "*.py"). Optional.' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive search (default false)' },
      },
      required: ['project_id', 'pattern'],
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
    name: 'create_artifact',
    description: 'Create a durable project artifact for an inspectable output such as research, reports, summaries, drafts, test results, screenshots metadata, or other deliverables. Use this when the orchestrator produces an output the user may want to review later in the project Artifacts tab.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project this artifact belongs to' },
        kind: { type: 'string', description: "Artifact category, e.g. 'research', 'report', 'summary', 'design', 'test_report'." },
        title: { type: 'string', description: 'Human-readable artifact title' },
        description: { type: 'string', description: 'Optional short description' },
        content: { type: 'string', description: 'Text content to store for this artifact' },
        mime_type: { type: 'string', enum: ['text/markdown', 'text/plain', 'application/json'], description: 'Text MIME type for the artifact content. Defaults to text/markdown.' },
        status: { type: 'string', enum: ['ready', 'review', 'running', 'error'], description: "Artifact status. Use 'review' when user review is expected." },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to link this artifact to, when applicable' },
      },
      required: ['project_id', 'kind', 'title', 'content'],
    },
  },
  {
    name: 'register_artifact',
    description: 'Register an existing file from the project repo as a project artifact, making it visible in the Artifacts tab. Use this when a coding agent has produced a file (video, image, PDF, etc.) that should be surfaced as an artifact. Copies the file into the project media store.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project' },
        file_path: { type: 'string', description: 'Absolute path to the file to register' },
        title: { type: 'string', description: 'Human-readable title (defaults to filename)' },
        kind: { type: 'string', description: "Artifact kind, e.g. 'media', 'report'. Defaults based on file type." },
        campaign_task_id: { type: 'string', description: 'Campaign task ID to mark done when this step is part of a campaign.' },
      },
      required: ['project_id', 'file_path'],
    },
  },
  {
    name: 'list_artifacts',
    description: "List all artifacts for a project — id, kind, title, status, mime_type, and created_at. Use to discover what's been produced before calling read_artifact.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'read_artifact',
    description: 'Read the text content of a project artifact. Works for text/markdown, text/plain, and application/json artifacts. Get artifact IDs from list_artifacts.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project the artifact belongs to' },
        artifact_id: { type: 'string', description: 'ID of the artifact to read' },
      },
      required: ['project_id', 'artifact_id'],
    },
  },
  {
    name: 'list_connections',
    description: 'List configured connections (API keys, GitHub, MCP servers). For MCP connections, includes available tool names so you know what to pass to mcp_call.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'test_connection',
    description: 'Test whether a connection is reachable and working. For MCP connections, pings the server and returns its available tools. For other connection types, verifies credentials are present. Use before dispatching work that depends on a connection.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'ID of the connection to test' },
      },
      required: ['connection_id'],
    },
  },
  {
    name: 'list_chats',
    description: 'List recent chats. Use to find a chat ID before calling read_chat, especially for chats older than the 5 shown in your context.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Filter to chats pinned to this project (optional)' },
        limit: { type: 'number', description: 'Max chats to return (default 20, max 100)' },
      },
    },
  },
  {
    name: 'read_chat',
    description: 'Retrieve messages from a previous chat. Use when the user references past work, asks to continue something, or you need context before responding.',
    input_schema: {
      type: 'object',
      properties: {
        chat_id: { type: 'string', description: 'ID of the chat to read — get IDs from the recent chats list in your context or from list_chats' },
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
    name: 'resume_campaign',
    description: 'Resume a failed campaign by resetting errored tasks back to waiting. Returns the full task list with updated statuses so you know which tasks need to be re-dispatched (done tasks are left alone). After calling this, re-dispatch only the waiting tasks with their existing task IDs.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'ID of the failed campaign to resume' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'list_campaigns',
    description: 'List campaigns for a project — id, title, status, task counts, and timestamps. Use this to survey past campaigns before deciding whether to create a new one or investigate a failed one.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'get_campaign',
    description: 'Get full detail for a single campaign — all tasks with their statuses, execution IDs, and final result strings. Use after list_campaigns to inspect a specific campaign. To read full output logs for a task, use get_execution_output with the task\'s execution_id.',
    input_schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'ID of the campaign' },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_execution_output',
    description: 'Get the full output log and result for a single execution (a task run). Use this to read error details or full agent output for a specific campaign task. Get the execution_id from get_campaign.',
    input_schema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'ID of the execution to inspect' },
      },
      required: ['execution_id'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks for the user — their type, interval, enabled status, and next/last run times.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_scheduled_task',
    description: "Create a recurring scheduled task. Use type 'reorganize_memory' (no prompt needed) to auto-tidy memory on an interval. Use type 'custom_prompt' with a prompt to run any agent instruction on a schedule (e.g. daily standup, weekly report, regular codebase health check).",
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['reorganize_memory', 'custom_prompt'], description: "Task type" },
        interval_hours: { type: 'number', description: 'How often to run, in hours (e.g. 24 = daily, 168 = weekly)' },
        prompt: { type: 'string', description: "Required for type 'custom_prompt' — the instruction to run each time" },
      },
      required: ['type', 'interval_hours'],
    },
  },
  {
    name: 'update_scheduled_task',
    description: 'Enable/disable a scheduled task or change its interval.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        enabled: { type: 'boolean', description: 'Enable or disable the task' },
        interval_hours: { type: 'number', description: 'New interval in hours' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'delete_scheduled_task',
    description: 'Permanently delete a scheduled task.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'generate_video',
    description: 'Render an MP4 video for a project from structured scene data. Runs asynchronously; returns immediately with the execution id, and the finished video is registered in the project Artifacts tab.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID of the project to render video for' },
        title: { type: 'string', description: 'Video title' },
        scenes: {
          type: 'array',
          description: 'Ordered list of scenes to render',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to display during this scene' },
              durationInSeconds: { type: 'number', description: 'How long this scene lasts' },
              imageUrl: { type: 'string', description: 'Optional background image URL for this scene' },
            },
            required: ['text', 'durationInSeconds'],
          },
        },
      },
      required: ['project_id', 'title', 'scenes'],
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
