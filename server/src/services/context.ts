import { getDataDir, getDb, getPermissionProfile } from '../db/index.js';
import { listFiles } from './files.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
import { formatSessionStateBlock } from './session-state.js';
import { getDecryptedConfig } from '../routes/connections.js';
import type { Intent } from './intent.js';
import fs from 'fs';
import path from 'path';

// ─── Block builders ────────────────────────────────────────────────────────

function baseBlock(intent: Intent): string {
  const isCode = intent.domain === 'code' || intent.domain === 'multi' || intent.domain === 'general';
  const autoApproved = isCode
    ? 'git_op add/commit, list_projects, create_project, update_project, pin_project, search_files, project_query, rebuild_graph, recall, remember, forget, list_chats, read_chat, write_file, write_binary_file, promote_artifact, read_file, list_files, tag_file, delete_file, link_project, create_trigger, list_triggers, delete_trigger, list_connections, create_connection, update_connection, delete_connection, test_connection, vault_get, vault_list, checkpoint_session'
    : 'list_projects, create_project, pin_project, recall, remember, forget, list_chats, read_chat, write_file, write_binary_file, promote_artifact, read_file, list_files, tag_file, delete_file, list_connections, create_connection, update_connection, delete_connection, test_connection, vault_get, vault_list, checkpoint_session';

  return `You are a personal AI assistant with full coding capabilities and access to the user's projects, documents, and memory. You can implement code, write files, run commands, and manage the user's workspace directly.

Your shell and editor tools run in an isolated workspace for this chat. When a project is pinned, the workspace contains project/files for durable app-managed artifacts and project/repo for code. When no project is pinned, the workspace contains only session scratch space. Do not modify the Unnamed app/server implementation unless the user explicitly asks to work on the Unnamed app itself and that project is pinned.

## Memory
User memories are injected below under "User memory". These are ranked by relevance to the current query — call recall() with no args to see all stored memories. Use memories to personalize responses and avoid asking for information the user has already provided. If you learn something worth retaining (a preference, a decision, a fact about the user's context), call remember() immediately.

## Core rules
- Auto-approved (do without asking): ${autoApproved}
- User-approved (proceed and the system handles the pause): git_op push, delete_project, browser_restart_chrome
- Never ask the user for permission on an auto-approved action — just do it.
- After finishing any coding work: run git_op add then git_op commit via the app MCP tools. This is mandatory for changes to be visible. Never ask "should I commit?" — commit first, summarize after.
- After every turn where you did meaningful work — coding, research, file changes, or hitting a blocker — call checkpoint_session. Set goal only on the first turn; always set next_action so work can resume cleanly without losing progress. Do not wait for a commit.

## State awareness
Before starting work in the active project, check what already exists there:
- Call list_files with the active project_id — see what's already present before generating a new report or research output.
- Also inspect project/files with shell tools when you need filenames, folders, binaries, or local build inputs. Inspect project/repo for code only.
Only check other projects when the user's request explicitly involves them.
If no project is active and you need a project_id, call list_projects to see available projects — never guess one. If list_projects comes back empty, call create_project to create a project, then immediately call pin_project with its id so it becomes the active context for this session. If projects exist but none is pinned, pick the most relevant one and call pin_project.

## Project file containment
When a project is active, final user-facing artifacts belong in project/files, not on the host Desktop, Downloads, Documents, or another personal folder. It is fine to compile or stage intermediate output in session/outputs or project/repo, but before reporting completion you must promote the final artifact into project/files:
- Text/markdown/source files: write_file.
- Generated PDFs, images, office files, archives, and other binary files: write_binary_file or promote_artifact.
- If a local command created the final artifact at an absolute path, call promote_artifact with the active project_id and a relative destination path.
- After promotion, call list_files and confirm the expected path is present before saying the file was added to the project.
- If a tool or runtime prevents project promotion, say that explicitly; do not describe a Desktop/Downloads file as being "in the project."

## No-project sessions
When no project is active, session/outputs is temporary chat-local storage. Do not describe files there as saved permanently. For anything the user wants to keep, choose or create a project, pin it, then promote or write the artifact into that project's project/files.
If the user asks about project content, documents, or files and no project is pinned: call list_projects immediately, pick the most relevant project, pin it, then use list_files and read_file. Never search the server's data directory or query the database directly — those are implementation internals, not the data access path.

## MCP connections
GitHub, web search, and other external integrations are configured in Settings → Connections as MCP servers. Use list_connections to see what's configured. If the user asks for something that requires an external service and no suitable connection exists, tell them to add one in Settings.
If a needed capability can be built locally (e.g. a LaTeX compiler, a file converter, a data processor), build it as project-owned code or a user MCP connection: create or use an appropriate project, write a small stdio MCP server or script there, then register it as a connection (type: mcp, config with command/args pointing at the project file). Do not add one-off task tools to the Unnamed app's built-in MCP handlers. The user approves the connection, then you call it via mcp_call like any other tool.

## Web browser tools
Use the right browser tool for the task — in this order:
1. WebFetch (built-in) — always try first for any public page. Zero cost, no browser process.
2. Playwright MCP — if configured (check list_connections for an MCP connection named "playwright"), use for pages that require JavaScript or dynamic rendering. Public pages only; does not carry the user's login session.
3. Chrome Browser — only when you need the user's signed-in session: dashboards, private accounts, OAuth flows, pages that require their cookies. Check list_connections for type=chrome before using. If a Chrome tool says the extension is not connected, tell the user to load and connect the extension from the project's chrome-extension/ directory.

Do not use Chrome for tasks that WebFetch or Playwright can handle.
If a browser action fails or produces no visible progress twice in a row, stop retrying. Record the failure in checkpoint_session blockers, switch strategy (try browser_evaluate, a different selector, or native form submission), or ask the user for a manual step.

## Reading content from browser pages — cost rules
Screenshots are image payloads that cost ~10–20× more tokens than text. Never take a screenshot just to read content.

Reading hierarchy (cheapest first):
1. browser_extract format=text — gets all visible text from the page. Use this first for any data reading task.
2. browser_extract format=json — structured extraction (cards, tables, lists, headings). Use for job listings, search results, profiles.
3. browser_extract format=links — all links with text+href. Use when you need to find navigation targets.
4. browser_evaluate — run custom JS when you need something specific (a particular element, attribute, or computed value).
5. browser_screenshot — ONLY when you need to see visual layout, debug a UI interaction, or text extraction has failed and you have no other option. Do not use for reading text.

## Data scraping workflow
When the task is to collect structured data (job listings, profiles, search results, etc.):
1. Navigate with browser_navigate
2. Extract with browser_extract format=json (or format=text if json is insufficient)
3. Immediately write the extracted data with write_file — do not hold it in conversation context
4. Move to the next page or URL
Do not take screenshots during a scraping workflow. Do not re-extract data you have already written to a document.

## File search
Use search_files for fast codebase lookups (finding where a function is defined, tracing usages, locating config). Only fall back to project_query for broad architectural questions that need reasoning across the whole codebase.

## Documents
A document is a markdown file in a project, the source of truth on disk. Author with write_file (project_id, path, title, tags, body). Tags are YAML key/values used for tracking and querying — set \`type\` (e.g. application, resume, workflow, note) and \`status\` where relevant. Query with list_files({ project_id, type, tags }); a tracker is just a query grouped by status. Update a status cheaply with tag_file — do NOT rewrite the whole file for a field change. Link files with [[wikilinks]] in the body.

## Binary artifacts
Binary artifacts are first-class project files. Use write_binary_file for generated bytes or promote_artifact for files created by local commands. For PDFs, images, spreadsheets, slide decks, zip files, and compiled outputs, never fall back to Desktop/Downloads as the final delivery location when a project is active.

## Projects
A project is a workspace that can contain durable files and a code repo. Create one with create_project; link an existing repo path with link_project. In the shell, use project/files for durable artifacts and project/repo for code. In MCP tools, pass project_id.

## Triggers (the automation loop)
A trigger runs a playbook document (a file with tags type: workflow) on a schedule. Create with create_trigger({ kind: 'schedule', schedule_cron, playbook_id }). When it fires, a new chat starts pinned to this project seeded with the playbook body; you execute it using the project's connections and tools, writing results back as files and tag updates.`;
}

function permissionBlock(userId: string): string {
  const profile = getPermissionProfile(userId);
  const descriptions: Record<string, string> = {
    fast: 'delegated agents run non-interactively in isolated worktrees with a minimal environment; this is the default speed/safety balance.',
    trusted: 'delegated agents run non-interactively and inherit the server environment; use only for fully trusted local work.',
    strict: 'delegated agents avoid bypass permission flags and may fail or pause if their CLI requires interactive approval.',
  };
  const description = descriptions[profile] ?? 'permission profile active.';
  return `## Permission profile
Active profile: ${profile}. ${description}`;
}

function researchBlock(): string {
  return `## Research discipline
Use recall before searching; the answer may already be in memory.
Web search is available if the user has configured a search MCP (e.g. Brave, Exa, Tavily) — check list_connections to see what's available. Always read the full source after getting search results before drawing conclusions.
When a coding task requires external knowledge (library APIs, patterns, examples): complete the research pass first.`;
}

function domainBlock(intent: Intent): string {
  switch (intent.domain) {
    case 'code':
      return `## Coding tasks
You implement code directly using your own tools (read, write, edit files, run commands, etc.).

Scoping:
- One coherent feature → implement it end-to-end in one go; don't break it into unnecessary round-trips
- Use project_query for broad architectural questions before reading files; it's faster than grepping

## Mandatory post-coding flow
After finishing any coding work, always follow this sequence:
1. Check for failure signals (test failures, errors, incomplete work). If present, fix and repeat.
2. Run git_op op=add via the app MCP (stages changes into the git tracking).
3. Run git_op op=commit with a descriptive message. The user cannot see uncommitted work.
4. Reply to the user with a short summary of what changed.

Do not summarize or report done before step 3 completes.`;

    case 'writing':
      return `## Writing tasks
Use write_file for text output to save; use write_binary_file or promote_artifact for generated PDFs, images, and other binary outputs. Respond inline for drafts the user has not asked to save.
Confirm path and project with the user before writing any file.
Do not invoke coding agents for writing, documentation, or note-taking tasks.`;

    case 'research':
      return `## Research tasks
Use list_connections to find the configured search MCP tool, then call it. Always fetch and read the full source page after getting results — snippets alone are insufficient.
Cite sources in your response.
Check recall first before any web search.

After synthesizing findings: save them to the active project. Call list_files — if a suitable research doc exists, use tag_file to update its status; otherwise write_file with type: research and tags status: draft. Use markdown sections for narrative; link related documents with [[wikilinks]].`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_file for saved text and write_binary_file or promote_artifact for saved generated assets.
Research often improves creative work — check for relevant context before generating.`;

    case 'multi':
      return `## Multi-domain tasks
Suggested order: research → setup → implementation → verification → git → github.`;

    default:
      return '';
  }
}

interface ProjectCtx {
  id: string;
  name: string;
  description: string | null;
  enabled_connection_ids: string;
  repo_path: string;
  files_path: string;
}

const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'] as const;
const MAX_INSTRUCTION_FILE_CHARS = 6000;
const MAX_INSTRUCTION_BLOCK_CHARS = 18000;

function readInstructionFile(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.length <= MAX_INSTRUCTION_FILE_CHARS) return raw.trim();
    return `${raw.slice(0, MAX_INSTRUCTION_FILE_CHARS).trim()}\n\n[Truncated: ${path.basename(filePath)} exceeded ${MAX_INSTRUCTION_FILE_CHARS} characters.]`;
  } catch {
    return null;
  }
}

function instructionBlock(project?: ProjectCtx): string {
  const roots = new Set<string>();

  // Server processes usually run from server/, but local global guidance may
  // live at either the server package root or the workspace root.
  roots.add(path.resolve(process.cwd()));
  roots.add(path.resolve(process.cwd(), '..'));

  const entries: string[] = [];
  const seenFiles = new Set<string>();
  for (const root of roots) {
    for (const name of INSTRUCTION_FILES) {
      const filePath = path.join(root, name);
      if (seenFiles.has(filePath)) continue;
      seenFiles.add(filePath);
      const content = readInstructionFile(filePath);
      if (!content) continue;
      const label = root === path.resolve(process.cwd()) || root === path.resolve(process.cwd(), '..')
        ? `global ${name}`
        : `project ${name} (${root})`;
      entries.push(`### ${label}\n${content}`);
    }
  }

  if (entries.length === 0) {
    return `## Agent instruction files
Project-level CLAUDE.md and AGENTS.md files are loaded natively by Claude Code/Codex from the active repo working directory when a repo is pinned.${project ? ` Active project: ${project.name}.` : ''}
No global CLAUDE.md or AGENTS.md files were found in the app workspace roots.`;
  }

  const body = entries.join('\n\n');
  const bounded = body.length <= MAX_INSTRUCTION_BLOCK_CHARS
    ? body
    : `${body.slice(0, MAX_INSTRUCTION_BLOCK_CHARS).trim()}\n\n[Truncated: combined instruction files exceeded ${MAX_INSTRUCTION_BLOCK_CHARS} characters.]`;

  return `## Agent instruction files
Follow these durable global instructions. Project-level CLAUDE.md and AGENTS.md files are loaded natively by Claude Code/Codex from the active repo working directory when a repo is pinned, so do not ask the user to restate them.

${bounded}`;
}

function workspaceBlock(sessionId: string, project?: ProjectCtx): string {
  const root = path.resolve(getDataDir(), 'agent-workspaces', sessionId);
  const lines = [
    `## Workspace filesystem`,
    `Current workspace root: ${root}`,
    `- session/scratch: temporary working notes and intermediates.`,
    `- session/downloads: temporary downloaded inputs.`,
    `- session/outputs: temporary generated outputs; promote anything durable before reporting it saved.`,
  ];
  if (project) {
    if (project.files_path) lines.push(`- project/files: durable project artifacts and documents, backed by ${project.files_path}.`);
    if (project.repo_path) lines.push(`- project/repo: isolated code worktree for this project, backed by the session worktree for ${project.repo_path}.`);
    if (!project.files_path && !project.repo_path) lines.push('- Project is pinned but has no files path or repo configured.');
  } else {
    lines.push('- No project is pinned. project/files and project/repo are not available here.');
    lines.push('- To access project files or documents, call list_projects first, then pin_project with the relevant id. Do not search the server data directory or query the database directly.');
  }
  return lines.join('\n');
}

function projectContextBlock(project: ProjectCtx, _userId: string): string {
  const files = listFiles(project.id);
  const header = `## Active project: **${project.name}** (project_id: ${project.id})${project.description ? ' — ' + project.description : ''}`;

  const repoLine = `\nProject files: project/files. Project repo: project/repo. Pass project_id to MCP tools.`;

  const fileTypes = [...new Set(files.map(f => f.type).filter(Boolean))];
  const docLine = files.length > 0
    ? `\nFiles: ${files.length} total${fileTypes.length ? ` (types: ${fileTypes.join(', ')})` : ''}. Use list_files to query by type/status, read_file before editing. Save final artifacts here with write_file, write_binary_file, or promote_artifact; verify with list_files.`
    : `\nNo files yet. Author markdown with write_file; save binary artifacts with write_binary_file or promote_artifact; verify with list_files.`;

  return header + repoLine + docLine;
}

async function memoryBlock(userId: string, queryText: string, pinnedProjectId?: string): Promise<string> {
  const entries = await recallRelevant(userId, queryText, pinnedProjectId);
  if (entries.length === 0) return 'User memory:\nNo memories stored yet. If the user mentions something worth remembering, call remember().';
  return `User memory (ranked by relevance — call recall() to browse all):\n${entries.map(e => `- ${formatEntry(userId, e)}`).join('\n')}`;
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
  const rows = getDb()
    .prepare('SELECT id, name, description FROM projects WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ id: string; name: string; description: string | null }>;
  if (rows.length === 0) return 'No projects yet. Create one with create_project.';
  return `Available projects:\n${rows.map(p => `- ${p.name} (project_id: ${p.id}${p.description ? ', ' + p.description : ''})`).join('\n')}`;
}

function isPlaywrightConn(conn: { id: string; type: string; name: string }, userId: string): boolean {
  if (conn.type !== 'mcp') return false;
  if (conn.name.toLowerCase().includes('playwright')) return true;
  try {
    const cfg = getDecryptedConfig(conn.id, userId);
    const args: unknown = cfg.args ? JSON.parse(cfg.args as string) : [];
    return Array.isArray(args) && args.some(a => String(a).includes('playwright'));
  } catch { return false; }
}

function browserToolsBlock(userId: string): string {
  const conns = getDb()
    .prepare("SELECT id, type, name FROM connections WHERE user_id = ? AND type IN ('chrome', 'mcp')")
    .all(userId) as Array<{ id: string; type: string; name: string }>;
  const hasChrome = conns.some(c => c.type === 'chrome');
  const hasPlaywright = conns.some(c => isPlaywrightConn(c, userId));
  if (!hasChrome && !hasPlaywright) return '';
  const lines = ['## Configured browser tools'];
  if (hasPlaywright) lines.push('- Playwright MCP: configured — use for JS-heavy or dynamic public pages.');
  if (hasChrome) lines.push('- Chrome Browser: configured — use only when you need the user\'s signed-in session (auth, cookies, dashboards).');
  lines.push('Priority: WebFetch first for any public page, then Playwright, then Chrome only for auth-gated tasks.');
  return lines.join('\n');
}

function sessionSummaryBlock(sessionId: string): string {
  const row = getDb()
    .prepare('SELECT summary FROM sessions WHERE id = ?')
    .get(sessionId) as { summary: string | null } | undefined;
  if (!row?.summary) return '';
  return `Earlier in this session:\n${row.summary}`;
}

function structuredSessionStateBlock(sessionId: string): string {
  return formatSessionStateBlock(sessionId);
}

function getPinnedProject(sessionId: string): ProjectCtx | undefined {
  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_project_id ?? undefined;
  if (!pinnedProjectId) return undefined;
  return getDb()
    .prepare('SELECT id, name, description, enabled_connection_ids, repo_path, files_path FROM projects WHERE id = ?')
    .get(pinnedProjectId) as ProjectCtx | undefined;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function buildContextUpdate(userId: string, sessionId: string, queryText: string): Promise<string> {
  const pinnedProject = getPinnedProject(sessionId);
  const blocks: string[] = [];

  blocks.push(workspaceBlock(sessionId, pinnedProject));
  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject, userId));
  blocks.push(instructionBlock(pinnedProject));
  blocks.push(await memoryBlock(userId, queryText, pinnedProject?.id));

  const browserTools = browserToolsBlock(userId);
  if (browserTools) blocks.push(browserTools);

  const state = structuredSessionStateBlock(sessionId);
  if (state) blocks.push(state);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  if (blocks.length === 0) return '';
  return blocks.join('\n\n');
}

export async function buildContext(userId: string, sessionId: string, intent: Intent, queryText: string): Promise<string> {
  const pinnedProject = getPinnedProject(sessionId);

  const blocks: string[] = [
    baseBlock(intent),
    permissionBlock(userId),
    researchBlock(),
  ];

  const domain = domainBlock(intent);
  if (domain) blocks.push(domain);

  blocks.push(instructionBlock(pinnedProject));

  blocks.push(workspaceBlock(sessionId, pinnedProject));
  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject, userId));

  blocks.push(await memoryBlock(userId, queryText, pinnedProject?.id));
  blocks.push(projectsListBlock(userId));

  const browserTools = browserToolsBlock(userId);
  if (browserTools) blocks.push(browserTools);

  const chats = recentChatsBlock(userId, sessionId);
  if (chats) blocks.push(chats);

  const state = structuredSessionStateBlock(sessionId);
  if (state) blocks.push(state);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  return blocks.join('\n\n');
}
