import fs from 'fs';
import path from 'path';
import { getDb, getDataDir, getPermissionProfile, type DbSpace } from '../db/index.js';
import { getItemsForSpace, type RepoItem } from './items.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
import type { Intent } from './intent.js';
import { detectCapabilities } from './projectCapabilities.js';

// ─── Block builders ────────────────────────────────────────────────────────

function readWorkspaceMd(space: DbSpace, repoPath: string | null): string | null {
  const filePath = repoPath
    ? path.join(repoPath, 'workspace.md')
    : path.join(getDataDir(), 'doc-projects', space.id, 'files', 'workspace.md');
  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    const MAX = 4000;
    return content.length > MAX ? content.slice(0, MAX) + '\n\n_(workspace.md truncated — file exceeds 4000 chars)_' : content;
  } catch {
    return null;
  }
}

function baseBlock(intent: Intent): string {
  const isCode = intent.domain === 'code' || intent.domain === 'multi' || intent.domain === 'general';
  const autoApproved = isCode
    ? 'invoke_claude_code, invoke_codex, git_op add/commit, run_command, list_spaces, create_space, update_space, pin_space, project_query, rebuild_graph, search_files, read_file, list_dir, recall, remember, forget, list_chats, read_chat, register_file_item, create_note, list_items, read_item, list_connections, test_connection, tool_search, get_execution_output, wait_for_execution, list_scheduled_tasks, create_scheduled_task, update_scheduled_task'
    : 'list_spaces, create_space, pin_space, search_files, read_file, list_dir, recall, remember, forget, write_file, run_command, list_chats, read_chat, create_note, list_items, read_item, list_connections, test_connection, tool_search';

  return `You are a personal AI operator and orchestrator. You decide how work gets done — you never implement code, write files, or run git operations yourself when the task belongs to a coding agent.

## Core rules
- Auto-approved (do without asking): ${autoApproved}
- User-approved (proceed and the system handles the pause): git_op push, delete_space, delete_scheduled_task
- write_file auto-approves on fast/trusted profiles; on strict it pauses for user approval like any other tool
- Never ask the user for permission on an auto-approved action — just do it.
- After any invoke_claude_code or invoke_codex succeeds: immediately run git_op add then git_op commit. This is mandatory. Never ask "should I commit?" or "would you like me to commit?" — that question is a protocol violation. Commit first, summarize after.

## State awareness
Before starting work in the active Space, check what already exists there:
- Call list_items with the active space_id — see what's already present before generating a new report or research output.
Only check other Spaces when the user's request explicitly involves them.
If no Space is active and you need a space_id, call list_spaces first — never guess one (e.g. "default"). If list_spaces comes back empty, call create_space to create one, then immediately call pin_space with the new space's id so it becomes the active context for this session. If spaces exist but none is pinned, pick the most relevant one and call pin_space.

## MCP connections
GitHub, web search, and other external service integrations are provided through MCP servers configured in Settings → MCP. To use an MCP tool, first use tool_search to discover available tools by describing what you need, or use list_connections to see all configured servers and their tools. Never guess a connection_id or tool name. Use test_connection to verify an MCP server is reachable before dispatching dependent work. If the user asks you to do something that requires GitHub or web search and no suitable MCP is configured, tell them which type of MCP server to add (e.g. GitHub MCP for repo/PR/issue operations, a search MCP like Brave or Exa for web research).

## File search
Use search_files for fast codebase lookups (finding where a function is defined, tracing usages, locating config). Only fall back to project_query for broad architectural questions that need reasoning across the whole codebase.

## Interactive items
Items support input blocks — labeled fields the user fills in that you can read back via read_item. Use these to build lightweight configuration surfaces or data-collection forms inside the space:
- \`{ type: 'input', label: 'API endpoint', value: '', placeholder: 'https://...', input_type: 'text' }\`
- \`{ type: 'input', label: 'Environment', value: 'staging', input_type: 'select', options: ['dev', 'staging', 'prod'] }\`
- \`{ type: 'input', label: 'Notes', value: '', input_type: 'multiline' }\`
- \`{ type: 'input', label: 'Retries', value: '3', input_type: 'number' }\`

Create an item with input blocks when the task needs persistent user-defined parameters. The user fills in the fields in the UI; call read_item to see current values before acting. Patch a single field after the user updates it using update_item with block_id + block (all blocks have a stable id once written).`;
}

function permissionBlock(userId: string): string {
  const profile = getPermissionProfile(userId);
  const description = {
    fast: 'delegated agents run non-interactively in isolated worktrees with a minimal environment; this is the default speed/safety balance.',
    trusted: 'delegated agents run non-interactively and inherit the server environment; use only for fully trusted local work.',
    strict: 'delegated agents avoid bypass permission flags and may fail or pause if their CLI requires interactive approval.',
  }[profile];
  return `## Permission profile
Active profile: ${profile}. ${description}`;
}

function researchBlock(): string {
  return `## Research discipline
Use recall before searching; the answer may already be in memory.
Web search and fetch are provided by MCP servers (e.g. Brave, Exa, Tavily) — use tool_search to find the available search tool by describing what you need. Always read the full source after getting search results before drawing conclusions.
When a coding task requires external knowledge (library APIs, patterns, examples): complete the research pass first and include findings in the agent brief.`;
}

function domainBlock(intent: Intent): string {
  switch (intent.domain) {
    case 'code':
      return `## Coding tasks
worktree isolation: coding agents work on an isolated branch — the user's main checkout is never touched.

Scoping rules — choose the right unit of work:
- One coherent feature with clear scope → one ambitious invoke_claude_code prompt (describe what exists, what to build, what "done" means including tests passing)
- Never break a coherent task into multiple small round-trips — it wastes context and loses continuity
- Quick checks (run tests, inspect git log, list files, check a process) → run_command directly; do not spin up a coding agent for a one-liner

Sub-agent model hints (pass as model param to invoke_claude_code):
- 'haiku': trivial edits, single-file changes
- 'sonnet': standard feature work (default)
- 'opus': architectural decisions, large refactors, complex multi-file reasoning

Agent brief quality: always include — what already exists (from project_query, search_files, or research), what to build, and what "done" means. A thin prompt wastes what these agents can do. Err toward more context, not less.

## Mandatory post-coding flow (every invoke_claude_code or invoke_codex call)
After the agent returns, always follow this exact sequence — do not skip any step:
1. Read the result for failure signals (test failures, errors, "could not", partial completion). If present, send a targeted follow-up correction, then repeat from step 1.
2. Run git_op with op=add (space_id = the same Space). No permission needed.
3. Run git_op with op=commit, message describing what was done. No permission needed.
4. Write a work log entry to the space: call list_items, find an existing report/log item (or create_item with type 'tpl_report' named "Work Log"), then update_item with append_blocks — a heading block for the task and a text block summarizing what changed and what to verify. Never use page_blocks here; append_blocks is safe and doesn't require reading first.
5. Only after steps 3–4: reply to the user with a short summary.

The user cannot see or access work that is not committed. Do not summarize or report as done before step 3 completes.

Choosing invoke_claude_code vs invoke_codex: pick whichever fits the task best — both are capable coding agents. Use the agent usage section to weigh cost/budget when the two are otherwise a toss-up, and consider a parallel second approach (one task on each) for tasks that benefit from comparing two independent implementations.`;

    case 'writing':
      return `## Writing tasks
Use write_file for output to save; respond inline for drafts the user has not asked to save.
Confirm path and project with the user before writing any file.
Do not invoke coding agents for writing, documentation, or note-taking tasks.`;

    case 'research':
      return `## Research tasks
Use tool_search to find the configured search MCP tool by describing what you need, then call it. Always fetch and read the full source page after getting results — snippets alone are insufficient.
Cite sources in your response.
Check recall first before any web search.

After synthesizing findings: save them to the space. Call list_items — if a suitable research doc exists, use update_item with append_blocks; otherwise create_item with type 'tpl_report' and then append_blocks. Use text blocks for narrative, callout blocks (variant 'info') for key insights, a list block for sources. Don't just reply inline — structured output in the space is durable.`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_file when the user wants output saved.
Research often improves creative work — check for relevant context before generating.`;

    case 'multi':
      return `## Multi-domain tasks
Suggested order: research → setup → implementation → verification → git → github.
For parallel workstreams: dispatch multiple invoke_claude_code calls as needed, then gather results before the next phase.`;

    default:
      return '';
  }
}

function projectContextBlock(space: DbSpace): string {
  const repoItems = getItemsForSpace(space.id)
    .filter((item): item is RepoItem => item.type === 'repo');
  const repoPath = repoItems.length === 1 ? repoItems[0].repo_path : null;
  const detected = repoItems.map(item => detectCapabilities(item.id, item.repo_path));
  const has_graph = detected.some(value => value.has_graph);
  const capLabels: string[] = [];
  if (has_graph) capLabels.push('code graph indexed — use project_query for broad codebase questions before reading individual files');

  const header = `## Active space: **${space.name}** (id: ${space.id})${space.description ? ' — ' + space.description : ''}`;

  let guidance: string;
  if (repoItems.length > 0) {
    const capNote = capLabels.length > 0
      ? ` Detected capabilities: ${capLabels.join(', ')}.`
      : ' No special capabilities detected yet.';
    const repoList = repoItems.map(item => `${item.name} (item_id: ${item.id}, path: ${item.repo_path})`).join('; ');
    guidance = `\nCode space with repos: ${repoList}.${capNote} Every repo-scoped tool call must include the selected item_id.`;
  } else {
    guidance = `\nDoc/writing space (no git repo). Create and read note/file items directly.`;
  }

  const workspaceMd = readWorkspaceMd(space, repoPath);
  const workspaceSection = workspaceMd
    ? `\n\n### workspace.md\n${workspaceMd}\n\n_Update workspace.md after significant progress, decisions, or completed milestones._`
    : repoItems.length === 1
      ? `\n\n_No workspace.md yet. Use write_file with item_id ${repoItems[0].id} to create workspace.md._`
      : '';

  return header + guidance + workspaceSection;
}

async function memoryBlock(userId: string, queryText: string, pinnedProjectId?: string): Promise<string> {
  const entries = await recallRelevant(userId, queryText, pinnedProjectId);
  if (entries.length === 0) return 'User memory:\nNo memories stored yet.';
  return `User memory:\n${entries.map(e => `- ${formatEntry(userId, e)}`).join('\n')}`;
}

function timeAgo(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff <= 0) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function recentChatsBlock(userId: string, sessionId: string): string {
  const chats = getDb()
    .prepare('SELECT id, title, updated_at FROM sessions WHERE user_id = ? AND id != ? ORDER BY updated_at DESC LIMIT 10')
    .all(userId, sessionId) as Array<{ id: string; title: string | null; updated_at: number }>;
  if (chats.length === 0) return '';
  return `Recent chats (use read_chat to retrieve full context when relevant):\n${chats.map(c => `- "${c.title ?? 'Untitled'}" (id: ${c.id}, ${timeAgo(c.updated_at)})`).join('\n')}`;
}

function projectsListBlock(userId: string): string {
  const spaces = getDb()
    .prepare('SELECT id, name, description FROM spaces WHERE user_id = ?')
    .all(userId) as Array<{ id: string; name: string; description: string | null }>;
  if (spaces.length === 0) return 'No spaces yet.';
  return `Available Spaces:\n${spaces.map(p => `- ${p.name} (id: ${p.id})${p.description ? ': ' + p.description : ''}`).join('\n')}`;
}

function sessionSummaryBlock(sessionId: string): string {
  const row = getDb()
    .prepare('SELECT summary FROM sessions WHERE id = ?')
    .get(sessionId) as { summary: string | null } | undefined;
  if (!row?.summary) return '';
  return `Earlier in this session:\n${row.summary}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function buildContext(userId: string, sessionId: string, intent: Intent, queryText: string): Promise<string> {
  const session = getDb()
    .prepare('SELECT pinned_space_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_space_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_space_id ?? undefined;

  const pinnedProject = pinnedProjectId
    ? getDb().prepare('SELECT id, name, description, enabled_connection_ids FROM spaces WHERE id = ?')
        .get(pinnedProjectId) as DbSpace | undefined
    : undefined;

  const blocks: string[] = [
    baseBlock(intent),
    permissionBlock(userId),
    researchBlock(),
  ];

  const domain = domainBlock(intent);
  if (domain) blocks.push(domain);

  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject));

  blocks.push(await memoryBlock(userId, queryText, pinnedProjectId));
  blocks.push(projectsListBlock(userId));

  const chats = recentChatsBlock(userId, sessionId);
  if (chats) blocks.push(chats);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  return blocks.join('\n\n');
}
