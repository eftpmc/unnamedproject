import { getDb, getPermissionProfile } from '../db/index.js';
import { listProjects } from './projects.js';
import { listDocuments } from './documents.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
import type { Intent } from './intent.js';

// ─── Block builders ────────────────────────────────────────────────────────

function baseBlock(intent: Intent): string {
  const isCode = intent.domain === 'code' || intent.domain === 'multi' || intent.domain === 'general';
  const autoApproved = isCode
    ? 'git_op add/commit, list_projects, create_project, update_project, pin_project, search_files, project_query, rebuild_graph, recall, remember, forget, list_chats, read_chat, write_document, read_document, list_documents, patch_frontmatter, link_project, create_trigger, list_triggers, delete_trigger, list_connections, test_connection'
    : 'list_projects, create_project, pin_project, recall, remember, forget, list_chats, read_chat, write_document, read_document, list_documents, patch_frontmatter, list_connections, test_connection';

  return `You are a personal AI assistant with full coding capabilities and access to the user's projects, documents, and memory. You can implement code, write files, run commands, and manage the user's workspace directly.

## Core rules
- Auto-approved (do without asking): ${autoApproved}
- User-approved (proceed and the system handles the pause): git_op push, delete_project, browser_restart_chrome
- Never ask the user for permission on an auto-approved action — just do it.
- After finishing any coding work: run git_op add then git_op commit via the app MCP tools. This is mandatory for changes to be visible. Never ask "should I commit?" — commit first, summarize after.

## State awareness
Before starting work in the active project, check what already exists there:
- Call list_documents with the active project_id — see what's already present before generating a new report or research output.
Only check other projects when the user's request explicitly involves them.
If no project is active and you need a project_id, call list_projects to see available projects — never guess one. If list_projects comes back empty, call create_project to create a project, then immediately call pin_project with its id so it becomes the active context for this session. If projects exist but none is pinned, pick the most relevant one and call pin_project.

## MCP connections
GitHub, web search, and other external integrations are configured in Settings → Connections as MCP servers. Use list_connections to see what's configured. If the user asks for something that requires an external service and no suitable connection exists, tell them to add one in Settings.

## Chrome Browser
If the user has enabled Chrome Browser (check list_connections for type=chrome), you have access to browser_navigate, browser_screenshot, browser_click, browser_fill, browser_evaluate, browser_get_text, browser_tabs, browser_new_tab. These control the user's real Chrome browser with all their sessions and cookies. If Chrome is running without remote debugging, call browser_restart_chrome — it will ask the user for approval before restarting Chrome.

## File search
Use search_files for fast codebase lookups (finding where a function is defined, tracing usages, locating config). Only fall back to project_query for broad architectural questions that need reasoning across the whole codebase.

## Documents
A document is a markdown file in a project, the source of truth on disk. Author with write_document (project_id, path, title, frontmatter, body). Frontmatter is YAML key/values used for tracking and querying — set \`type\` (e.g. application, resume, workflow, note) and \`status\` where relevant. Query with list_documents({ project_id, type, frontmatter }); a tracker is just a query grouped by status. Update a status cheaply with patch_frontmatter — do NOT rewrite the whole file for a field change. Link documents with [[wikilinks]] in the body.

## Projects
A project is a workspace that can contain git repos and documents. Create one with create_project; link an existing repo path with link_project. Code tools (read/write/edit/bash/git) operate inside a project — pass its project_id.

## Triggers (the automation loop)
A trigger runs a playbook document (a document with frontmatter type: workflow) on a schedule. Create with create_trigger({ kind: 'schedule', schedule_cron, playbook_id }). When it fires, a new chat starts pinned to this project seeded with the playbook body; you execute it using the project's connections and tools, writing results back as documents and frontmatter updates.`;
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
Use write_document for output to save; respond inline for drafts the user has not asked to save.
Confirm path and project with the user before writing any file.
Do not invoke coding agents for writing, documentation, or note-taking tasks.`;

    case 'research':
      return `## Research tasks
Use list_connections to find the configured search MCP tool, then call it. Always fetch and read the full source page after getting results — snippets alone are insufficient.
Cite sources in your response.
Check recall first before any web search.

After synthesizing findings: save them to the active project. Call list_documents — if a suitable research doc exists, use patch_frontmatter to update its status; otherwise write_document with type: research and frontmatter status: draft. Use markdown sections for narrative; link related documents with [[wikilinks]].`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_document when the user wants output saved.
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
  space_id: string;
}

function projectContextBlock(project: ProjectCtx, _userId: string): string {
  const repos = listProjects(project.space_id);
  const docs = listDocuments(project.space_id);
  const header = `## Active project: **${project.name}** (project_id: ${project.id})${project.description ? ' — ' + project.description : ''}`;

  const repoLine = repos.length > 0
    ? `\nGit repos: ${repos.map(p => `${p.name} (project_id: ${p.id}, path: ${p.repo_path})`).join('; ')}. Pass project_id to code tools.`
    : `\nNo git repos in this project yet. Create one with create_project, or work in documents.`;

  const docTypes = [...new Set(docs.map(d => d.type).filter(Boolean))];
  const docLine = docs.length > 0
    ? `\nDocuments: ${docs.length} total${docTypes.length ? ` (types: ${docTypes.join(', ')})` : ''}. Use list_documents to query by type/status, read_document before editing.`
    : `\nNo documents yet. Author markdown with write_document.`;

  return header + repoLine + docLine;
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
  const rows = getDb()
    .prepare('SELECT id, name, description FROM projects WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as Array<{ id: string; name: string; description: string | null }>;
  if (rows.length === 0) return 'No projects yet. Create one with create_project.';
  return `Available projects:\n${rows.map(p => `- ${p.name} (project_id: ${p.id}${p.description ? ', ' + p.description : ''})`).join('\n')}`;
}

function sessionSummaryBlock(sessionId: string): string {
  const row = getDb()
    .prepare('SELECT summary FROM sessions WHERE id = ?')
    .get(sessionId) as { summary: string | null } | undefined;
  if (!row?.summary) return '';
  return `Earlier in this session:\n${row.summary}`;
}

function getPinnedProject(sessionId: string): ProjectCtx | undefined {
  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_project_id ?? undefined;
  if (!pinnedProjectId) return undefined;
  return getDb()
    .prepare('SELECT id, name, description, enabled_connection_ids, space_id FROM projects WHERE id = ?')
    .get(pinnedProjectId) as ProjectCtx | undefined;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function buildContextUpdate(userId: string, sessionId: string, queryText: string): Promise<string> {
  const pinnedProject = getPinnedProject(sessionId);
  const blocks: string[] = [];

  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject, userId));
  blocks.push(await memoryBlock(userId, queryText, pinnedProject?.id));

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

  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject, userId));

  blocks.push(await memoryBlock(userId, queryText, pinnedProject?.id));
  blocks.push(projectsListBlock(userId));

  const chats = recentChatsBlock(userId, sessionId);
  if (chats) blocks.push(chats);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  return blocks.join('\n\n');
}
