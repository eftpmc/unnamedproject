import type Anthropic from '@anthropic-ai/sdk';

const BLOCK_CATALOG = `Available block types:
- { type: 'text', content: string } — markdown text
- { type: 'heading', level: 1|2|3, text: string }
- { type: 'code', language: string, content: string }
- { type: 'table', headers: string[], rows: string[][] }
- { type: 'image', url: string, alt?: string, caption?: string }
- { type: 'list', ordered?: boolean, items: string[] } — a plain bullet/numbered list
- { type: 'task-list', tasks: { id: string, text: string, done: boolean }[] } — checkable items; users can toggle done
- { type: 'callout', variant: 'info'|'warning'|'success'|'error', content: string }
- { type: 'chart', chartType: 'line'|'bar'|'pie', title?: string, data: { label: string, value: number }[] }
- { type: 'stat', label: string, value: string, trend?: { direction: 'up'|'down'|'flat', label?: string } } — a single metric tile
- { type: 'progress', label?: string, value: number, max?: number } — a progress bar
- { type: 'file-browser' } — renders the repo's file tree (repo overview only)
Every block may carry a top-level 'id' (e.g. { id: 'open-issues-stat', type: 'stat', ... }) — give one to any block you expect to update later (especially stat/chart/progress blocks on a dashboard-like item), since update_item's block_id+block patch only works on blocks that have one. Blocks without an id can only be changed via a full blocks replace.`;

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'invoke_claude_code',
    description: `Dispatch Claude Code — a fully autonomous AI coding agent — to work inside the project repo. Claude Code can handle entire features end-to-end: it reads the codebase, plans changes, writes and edits files across multiple modules, runs tests and fixes failures, installs dependencies, sets up frameworks, refactors, debugs complex issues, and more. It operates in an isolated worktree so it never touches the main branch. Use this for any non-trivial coding task — don't limit it to small edits. Write rich, detailed prompts: describe what you want built, the context it fits into, relevant constraints, and what "done" looks like. Claude Code maintains conversation context across calls on the same session, so you can follow up, course-correct, or ask it to continue. Claude Code can run with an Anthropic API key from the user's connections, or locally if the claude CLI is already installed and authenticated on the machine — no connection required in that case.`,
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space' },
        item_id: { type: 'string', description: 'ID of the repo item to work in' },
        prompt: { type: 'string', description: 'The task to give Claude Code. Be specific and thorough — it can handle complex, multi-file work. Include context, constraints, and what done looks like.' },
        model: { type: 'string', description: "Optional model override for this run, e.g. 'sonnet', 'opus', 'haiku', 'fable', or a full model ID. Defaults to the CLI's configured default." },
      },
      required: ['space_id', 'item_id', 'prompt'],
    },
  },
  {
    name: 'invoke_codex',
    description: `Dispatch Codex — OpenAI's autonomous coding agent — to work inside the project repo. Like Claude Code, Codex can implement features, write and edit files, run commands, fix tests, and reason about a codebase. It operates in the same isolated worktree. Use Codex when the user prefers OpenAI models, or in parallel with Claude Code to get a second implementation or approach. Write detailed prompts — Codex performs best with clear context about the codebase, the goal, and expected output. Codex can run with an OpenAI API key from the user's connections, or locally if the codex CLI is already installed and authenticated on the machine — no connection required in that case.`,
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space' },
        item_id: { type: 'string', description: 'ID of the repo item to work in' },
        prompt: { type: 'string', description: 'The task to give Codex. Be specific — include codebase context, what to build, and what done looks like.' },
        model: { type: 'string', description: "Optional OpenAI model override for this run, e.g. 'gpt-5'. Defaults to the CLI's configured default." },
      },
      required: ['space_id', 'item_id', 'prompt'],
    },
  },
  {
    name: 'tool_search',
    description: 'Search for a tool by describing what you need to do. Returns the best-matching tools (name + description) across first-party tools and connected MCP servers. Once a tool is returned here, you can call it directly by name on this or any later turn in the conversation — it stays available for the rest of the session. If nothing relevant comes back, try rephrasing the query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Describe the capability you need, e.g. "create a github pull request" or "render a video from scenes"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command and return its output. Provide space_id and item_id to run in a specific repo item; omit both to run in the server data directory.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to run, e.g. "npm test", "git log --oneline -10"' },
        space_id: { type: 'string', description: 'Optional Space containing the repo item. Must be paired with item_id.' },
        item_id: { type: 'string', description: 'Optional repo item to use as the working directory. Must be paired with space_id.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000, max 60000.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_op',
    description: "Run git operations in this session's isolated agent worktree. To commit: run add first (stages everything), then commit. Push sends the session branch for PR review. Status and diff are useful for summarizing what changed.",
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to operate on' },
        op: { type: 'string', enum: ['log', 'diff', 'status', 'add', 'commit', 'push'] },
        message: { type: 'string', description: 'Commit message (for commit op)' },
        branch: { type: 'string', description: "Branch name to push (for push op, defaults to this session's agent branch)" },
      },
      required: ['space_id', 'item_id', 'op'],
    },
  },
  {
    name: 'project_query',
    description: 'Ask a question about a project codebase (structure, where something is implemented, how things connect). Queries a pre-built knowledge graph — fast and token-efficient. The graph is rebuilt automatically after coding agents finish, so it should already reflect recent changes; call rebuild_graph manually only if you suspect it is stale.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to query' },
        question: { type: 'string', description: 'What to look up in the codebase' },
      },
      required: ['space_id', 'item_id', 'question'],
    },
  },
  {
    name: 'rebuild_graph',
    description: 'Rebuild the knowledge graph for a project. The graph is rebuilt automatically after coding agents finish — you do not need to call this after a coding agent session. Only call it manually when you suspect the graph is stale, e.g. after editing files directly.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item whose graph should be rebuilt' },
      },
      required: ['space_id', 'item_id'],
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
    name: 'list_spaces',
    description: 'List all Spaces owned by the user, with id, name, and description. Call this before create_space when no active Space is known — never guess a space_id.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_space',
    description: "Create a new Space. If with_repo is true, creates a git repo under the configured Spaces root.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Space name' },
        description: { type: 'string', description: 'Optional description' },
        with_repo: { type: 'boolean', description: 'Whether to create a backing git repo for this Space' },
      },
      required: ['name', 'with_repo'],
    },
  },
  {
    name: 'update_space',
    description: "Update a Space's name or description.",
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        name: { type: 'string', description: 'New Space name' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'delete_space',
    description: 'Delete a Space. Requires user approval. Optionally deletes all linked repository directories from disk.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        delete_files: { type: 'boolean', description: 'Whether to also delete linked repository directories from disk' },
      },
      required: ['space_id', 'delete_files'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file in a workspace repo. For large files, use offset and limit to page through — offset is the 1-based starting line number, limit is the number of lines to return.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to read from' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
        offset: { type: 'number', description: 'First line to return (1-based). Omit to start from the beginning.' },
        limit: { type: 'number', description: 'Number of lines to return. Omit to return to the end of file.' },
      },
      required: ['space_id', 'item_id', 'path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a pattern across files in a project. Returns matching lines with file path and line number. Pattern is a JavaScript regex. Use file_glob to filter by filename (e.g. "*.ts"). Faster than reading files one by one for locating symbols, usages, or strings.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to search' },
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Subdirectory to search within (default: repo root)' },
        file_glob: { type: 'string', description: 'Filename pattern to restrict search (e.g. "*.ts", "*.py"). Optional.' },
        ignore_case: { type: 'boolean', description: 'Case-insensitive search (default false)' },
      },
      required: ['space_id', 'item_id', 'pattern'],
    },
  },
  {
    name: 'list_dir',
    description: 'List the contents of a directory in a workspace repo.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to list' },
        path: { type: 'string', description: 'Path relative to the workspace root (default: repo root)' },
      },
      required: ['space_id', 'item_id'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in a workspace repo, creating it if needed. Requires approval.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string' },
        item_id: { type: 'string', description: 'Repo item to write into' },
        path: { type: 'string', description: 'Path relative to the workspace root' },
        content: { type: 'string', description: 'New file contents' },
      },
      required: ['space_id', 'item_id', 'path', 'content'],
    },
  },
  {
    name: 'register_file_item',
    description: 'Copy an existing file into managed storage and register it as a file item in a Space.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space that owns the file item' },
        file_path: { type: 'string', description: 'Absolute path to the file to register' },
        name: { type: 'string', description: 'Human-readable name (defaults to filename)' },
      },
      required: ['space_id', 'file_path'],
    },
  },
  {
    name: 'create_note',
    description: 'Create a durable note item in a Space for research, reports, summaries, drafts, test results, or other text output.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space that owns the note' },
        name: { type: 'string', description: 'Human-readable note name' },
        content: { type: 'string', description: 'Markdown or plain-text note content' },
      },
      required: ['space_id', 'name', 'content'],
    },
  },
  {
    name: 'list_items',
    description: 'List all repo, file, note, and document items in a Space, including provenance fields.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'read_item',
    description: 'Returns the current content of an item including its blocks (for documents), overview_blocks (for repos), or content (for notes).',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space containing the item' },
        item_id: { type: 'string', description: 'ID of the item to read' },
      },
      required: ['space_id', 'item_id'],
    },
  },
  {
    name: 'list_item_templates',
    description: 'Lists item templates available to create items from: system templates (repo, file, note) and block templates (builtin and custom). Use this to find a template_id for create_item, or to see a template\'s current blocks before editing it with update_item_template.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_item_template',
    description: `Designs a new reusable block template (a named block layout/screen). Use this when no existing template fits what you want to build for the user — e.g. a custom dashboard, tracker, or report layout.\n\n${BLOCK_CATALOG}`,
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the template' },
        blocks: { type: 'array', description: 'Block array defining the template\'s starter layout' },
      },
      required: ['name', 'blocks'],
    },
  },
  {
    name: 'update_item_template',
    description: 'Redesigns an existing block template\'s blocks (including builtin templates). Only affects items created after this change — items already created from the template keep their own content.',
    input_schema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'ID of the template to update' },
        blocks: { type: 'array', description: 'Full replacement block array for the template' },
        name: { type: 'string', description: 'New display name (optional)' },
      },
      required: ['template_id', 'blocks'],
    },
  },
  {
    name: 'create_item',
    description: 'Creates an item in a space, always from a template. For documents: provide template_id (use list_item_templates to find one, or create_item_template to design a new one first; omit to use the plain Document template). For repos: provide repo_path. For notes: provide content. File items are not supported (files are upload-only).',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space to create the item in' },
        name: { type: 'string', description: 'Display name for the item' },
        type: { type: 'string', enum: ['document', 'repo', 'note'], description: 'Item type' },
        template_id: { type: 'string', description: 'Block template ID (only for type=document). Omit to use the plain Document template.' },
        repo_path: { type: 'string', description: 'Absolute filesystem path to the repository (only for type=repo)' },
        default_branch: { type: 'string', description: 'Default branch name (only for type=repo, optional)' },
        content: { type: 'string', description: 'Markdown content (only for type=note)' },
      },
      required: ['space_id', 'name', 'type'],
    },
  },
  {
    name: 'update_item',
    description: `Updates an item's content. Pass blocks to replace a document's entire blocks array, or — much cheaper for a document with several blocks (e.g. a dashboard) — pass block_id + block to replace just one block in place. block_id only works if the block was given a stable 'id' when created; blocks without one require a full blocks replace. Pass overview_blocks to set a repo's overview section, or content to update a note. Only pass fields that apply to the item type.\n\n${BLOCK_CATALOG}`,
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space containing the item' },
        item_id: { type: 'string', description: 'ID of the item to update' },
        blocks: { type: 'array', description: 'Full replacement blocks array (document items only)' },
        block_id: { type: 'string', description: 'id of a single existing block to replace (document items only; use with block, not blocks)' },
        block: { type: 'object', description: 'Replacement block content for block_id' },
        overview_blocks: { description: 'Overview blocks array or null to clear (repo items only)' },
        content: { type: 'string', description: 'Replacement markdown content (note items only)' },
      },
      required: ['space_id', 'item_id'],
    },
  },
  {
    name: 'list_connections',
    description: 'List configured connections (API keys, GitHub, MCP servers). For MCP connections, includes available tool names.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_connection',
    description: "Create a new connection (API key, GitHub token, MCP server) from credentials the user gives you in chat. Always requires the user's explicit approval before the credential is stored — you'll see whether they approved or denied. Use purpose 'claude_code' for a Claude Code connection, 'codex' for Codex, 'github' for a GitHub token, 'mcp' for an MCP server, or 'tool' for anything else. For type 'mcp', config needs command (string), and optionally args (array) and env (object). For type 'anthropic'/'openai'/'github', config needs apiKey.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable name for this connection' },
        type: { type: 'string', enum: ['anthropic', 'openai', 'github', 'mcp', 'local'], description: 'Connection type' },
        purpose: { type: 'string', enum: ['claude_code', 'codex', 'github', 'mcp', 'tool'], description: "What this connection is used for. Defaults to 'tool'." },
        config: { type: 'object', description: "Credential/config payload, e.g. {\"apiKey\":\"...\"} or {\"command\":\"npx\",\"args\":[...],\"env\":{...}} for mcp." },
      },
      required: ['name', 'type', 'config'],
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
        space_id: { type: 'string', description: 'Filter to chats pinned to this Space (optional)' },
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
    name: 'get_execution_output',
    description: 'Get the full output log and result for a single execution. Use this to read error details or full agent output.',
    input_schema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'ID of the execution to inspect' },
      },
      required: ['execution_id'],
    },
  },
  {
    name: 'wait_for_execution',
    description: 'Block until an execution reaches a terminal state (done or error), then return its result and output log. Use after generate_video (or any fire-and-forget tool) when downstream work depends on its completion. Times out after timeout_seconds (default 300, max 600) and returns an error string if still running.',
    input_schema: {
      type: 'object',
      properties: {
        execution_id: { type: 'string', description: 'ID of the execution to wait for' },
        timeout_seconds: { type: 'integer', description: 'Max seconds to wait before returning a timeout error (default 300, max 600)', minimum: 1, maximum: 600 },
      },
      required: ['execution_id'],
    },
  },
  {
    name: 'generate_video',
    description: 'Render an MP4 video for a Space from structured scene data. Runs asynchronously; returns immediately with the execution id, and the finished video is registered as a file Item in the Space.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space to render video for' },
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
      required: ['space_id', 'title', 'scenes'],
    },
  },
];
