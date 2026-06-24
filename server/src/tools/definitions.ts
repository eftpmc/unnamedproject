import type Anthropic from '@anthropic-ai/sdk';

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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this execution to (from create_plan response)' },
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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this execution to (from create_plan response)' },
      },
      required: ['space_id', 'item_id', 'prompt'],
    },
  },
  {
    name: 'tool_search',
    description: 'Search for a tool by describing what you need to do. Returns the best-matching tools (name + description) across first-party tools and connected MCP servers. Once a tool is returned here, you can call it directly by name on this or any later turn in the conversation — it stays available for the rest of the session. If nothing relevant comes back, try rephrasing the query. Does not search agent roles — use delegate_to_agent directly for sub-agent delegation.',
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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this execution to (from create_plan response)' },
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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this execution to (from create_plan response)' },
      },
      required: ['space_id', 'item_id', 'op'],
    },
  },
  {
    name: 'project_query',
    description: 'Ask a question about a project codebase (structure, where something is implemented, how things connect). Queries a pre-built knowledge graph — fast and token-efficient. The graph is rebuilt automatically after invoke_claude_code/invoke_codex finish, so it should already reflect recent changes; call rebuild_graph manually only if you suspect it is stale (e.g. after manual write_file edits).',
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
    description: 'Rebuild the knowledge graph for a project. The graph is rebuilt automatically after invoke_claude_code and invoke_codex finish — you do not need to call this after a coding agent session. Only call it manually when you suspect the graph is stale, e.g. after editing files directly with write_file.',
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
    description: "Update a Space's name or description.",
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: { type: 'string', description: 'New project name' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'delete_project',
    description: 'Delete a Space. Requires user approval. Optionally deletes all linked repository directories from disk.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Legacy parameter name for the Space ID' },
        delete_files: { type: 'boolean', description: 'Whether to also delete linked repository directories from disk' },
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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this execution to (from create_plan response)' },
      },
      required: ['space_id', 'item_id', 'path', 'content'],
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
        plan_step_id: { type: 'string', description: 'Plan step ID to link this item to, when applicable' },
      },
      required: ['space_id', 'name', 'content'],
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
        plan_step_id: { type: 'string', description: 'Plan step ID to mark done when this step is part of a plan.' },
      },
      required: ['space_id', 'file_path'],
    },
  },
  {
    name: 'list_items',
    description: 'List all repo, file, and note items in a Space, including provenance fields.',
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
    description: 'Read a note item or text file item. Repository items are not supported by this tool.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space' },
        item_id: { type: 'string', description: 'ID of the item to read' },
      },
      required: ['space_id', 'item_id'],
    },
  },
  {
    name: 'list_connections',
    description: 'List configured connections (API keys, GitHub, MCP servers). For MCP connections, includes available tool names — use tool_search to discover and call them by name.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_connection',
    description: "Create a new connection (API key, GitHub token, MCP server, or local model endpoint) from credentials the user gives you in chat. Always requires the user's explicit approval before the credential is stored — you'll see whether they approved or denied. Use purpose 'lead_agent' for the main conversation model, 'claude_code'/'codex' for coding agent auth, 'github' for a GitHub token, 'mcp' for an MCP server, or 'tool' for anything else. For type 'mcp', config needs command (string), and optionally args (array) and env (object). For type 'anthropic'/'openai'/'github', config needs apiKey. For type 'local', config needs baseUrl and modelName, apiKey optional. For lead_agent with type 'openai', config also needs modelName; with type 'local', config needs baseUrl and modelName.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human-readable name for this connection' },
        type: { type: 'string', enum: ['anthropic', 'openai', 'github', 'mcp', 'local'], description: 'Connection type' },
        purpose: { type: 'string', enum: ['lead_agent', 'claude_code', 'codex', 'github', 'mcp', 'tool'], description: "What this connection is used for. Defaults to 'tool'." },
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
    name: 'create_plan',
    description: 'Create a plan to track a coordinated multi-step effort. Supports two execution modes:\n\n**Manual dispatch** (existing): Call create_plan to get step IDs, then call invoke_claude_code / invoke_codex / etc. with plan_step_id to execute steps manually — useful when you need to inspect results between steps.\n\n**Auto-dispatch** (recommended for parallel work): Add a `prompt` to each step and `depends_on` (array of 0-based step indices) to declare dependencies, then call run_plan with the plan_id. Steps without dependencies run immediately in parallel; steps with dependencies wait for their deps to complete.\n\nStep agent types:\n- claude_code / codex: Fully autonomous coding agents — each step runs as an independent session that can implement entire features end-to-end: reading the codebase, writing and editing files across modules, running tests and fixing failures, installing dependencies, refactoring, and more. Write rich, detailed prompts for these steps exactly as you would for a direct invoke_claude_code call — describe what already exists, what to build, relevant constraints, and what "done" looks like. Do not write thin command-style prompts for coding agent steps; they are capable of handling ambitious, complex work.\n- mcp: MCP tool call\n- file_write: write a file\n- git: git operation\n- github: GitHub API\n- eval: run a shell command (prompt = the command, e.g. "npm test")\n- subagent: spawn a focused sub-agent with its own context window (lighter than a coding agent — use for analysis, summarization, or orchestration tasks, not for coding work)',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space this plan belongs to' },
        title: { type: 'string', description: 'Short name for the plan, e.g. "Auth refactor"' },
        steps: {
          type: 'array',
          description: 'Ordered list of planned steps',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short label for this step' },
              agent: { type: 'string', enum: ['claude_code', 'codex', 'mcp', 'file_write', 'git', 'github', 'eval', 'subagent'], description: 'Which executor to use' },
              prompt: { type: 'string', description: 'Instruction for the agent / command for eval / message for git commit. Required when using run_plan auto-dispatch. For claude_code/codex steps: write the same rich, detailed brief you would give a direct invoke_claude_code call — what already exists, what to build, and what done looks like. These are full independent sessions, not simple commands.' },
              depends_on: { type: 'array', items: { type: 'number' }, description: 'Zero-based indices of steps this step depends on. Steps with no depends_on run immediately in parallel when using run_plan.' },
              tool_args: { type: 'object', description: 'Additional tool-specific arguments (e.g. {"op":"commit","branch":"main"} for git, {"path":"src/foo.ts","content":"..."} for file_write, {"connection_id":"...","tool_name":"...","tool_input":{}} for mcp, {"model":"opus"} to override the model for claude_code/codex steps)' },
            },
            required: ['title', 'agent'],
          },
        },
      },
      required: ['space_id', 'title', 'steps'],
    },
  },
  {
    name: 'run_plan',
    description: 'Auto-dispatch all steps in a plan, running dependency-free steps in parallel and waiting for dependencies before starting dependent steps. Steps with no depends_on run immediately in parallel; steps only start once all their depends_on steps are done. Stops on first error by default. Use after create_plan when steps have prompts set.',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'ID of the plan to execute (returned by create_plan)' },
        on_error: { type: 'string', enum: ['stop', 'continue'], description: 'Whether to stop the entire plan on first step error (default: stop) or continue with independent steps.' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'create_pipeline',
    description: 'Create a reusable workflow template (pipeline) with named tasks and dependency declarations. Pipelines can be run multiple times via run_pipeline, which instantiates them as plans. Useful for recurring multi-step workflows like "test → build → deploy".',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'Space that owns this pipeline' },
        title: { type: 'string', description: 'Name of the pipeline, e.g. "CI: test and deploy"' },
        description: { type: 'string', description: 'What this pipeline does' },
        tasks: {
          type: 'array',
          description: 'Ordered list of task templates',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              agent: { type: 'string', enum: ['claude_code', 'codex', 'mcp', 'file_write', 'git', 'github', 'eval', 'subagent'] },
              prompt: { type: 'string', description: 'Default instruction/command for this task step. For claude_code/codex tasks: write the same rich, detailed brief you would give a direct invoke_claude_code call — what already exists, what to build, and what done looks like. These are full independent sessions, not simple commands.' },
              depends_on: { type: 'array', items: { type: 'number' }, description: 'Zero-based indices of tasks this step depends on' },
              tool_args: { type: 'object', description: 'Default tool-specific arguments for this step' },
            },
            required: ['title', 'agent'],
          },
        },
      },
      required: ['space_id', 'title', 'tasks'],
    },
  },
  {
    name: 'run_pipeline',
    description: 'Instantiate a pipeline template as a plan and auto-dispatch all its steps. Equivalent to create_plan + run_plan for a saved pipeline template.',
    input_schema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'ID of the pipeline to run (from create_pipeline)' },
        title: { type: 'string', description: 'Optional plan title override. Defaults to the pipeline title.' },
        on_error: { type: 'string', enum: ['stop', 'continue'], description: 'Whether to stop on first task error (default: stop)' },
      },
      required: ['pipeline_id'],
    },
  },
  {
    name: 'delegate_to_agent',
    description: 'Spawn a focused sub-agent with its own context window to complete a specific task. The sub-agent can read files, search code, write files, and create Space items, but cannot spawn further agents or create plans. Returns when the sub-agent finishes. Use for self-contained tasks that benefit from a fresh context.',
    input_schema: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Clear instructions for what the sub-agent should do and return' },
        space_id: { type: 'string', description: 'Optional Space context for the sub-agent' },
        max_turns: { type: 'integer', description: 'Maximum turns the sub-agent may take (1–50, default 15). Raise for complex multi-step tasks.', minimum: 1, maximum: 50 },
      },
      required: ['instructions'],
    },
  },
  {
    name: 'resume_plan',
    description: 'Resume a failed plan by resetting errored steps back to waiting. Returns the full step list with updated statuses so you know which steps need to be re-dispatched (done steps are left alone). After calling this, re-dispatch only the waiting steps with their existing step IDs.',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'ID of the failed plan to resume' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'list_plans',
    description: 'List plans for a Space — id, title, status, step counts, and timestamps.',
    input_schema: {
      type: 'object',
      properties: {
        space_id: { type: 'string', description: 'ID of the Space' },
      },
      required: ['space_id'],
    },
  },
  {
    name: 'get_plan',
    description: 'Get full detail for a single plan — all steps with their statuses, execution IDs, and final result strings. Use after list_plans to inspect a specific plan. To read full output logs for a step, use get_execution_output with the step\'s execution_id.',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'ID of the plan' },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'get_execution_output',
    description: 'Get the full output log and result for a single execution (a step run). Use this to read error details or full agent output for a specific plan step. Get the execution_id from get_plan.',
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
