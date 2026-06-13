import type Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { getDb, getAgentBudgets, getMonthlyUsage, getDataDir, type DbProject } from '../db/index.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
import { toolDefinitions } from '../tools/definitions.js';
import type { Intent } from './intent.js';
import { detectCapabilities } from './projectCapabilities.js';

// ─── Block builders ────────────────────────────────────────────────────────

function readWorkspaceMd(project: DbProject): string | null {
  const filePath = project.repo_path
    ? path.join(project.repo_path, 'workspace.md')
    : path.join(getDataDir(), 'doc-projects', project.id, 'files', 'workspace.md');
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
    ? 'invoke_claude_code, invoke_codex, generate_video, git_op add/commit, create_project, update_project, project_query, rebuild_graph, search_files, read_file, list_dir, recall, remember, forget, list_chats, read_chat, register_artifact, list_artifacts, read_artifact, list_connections, test_connection, create_campaign, resume_campaign, list_campaigns, get_campaign, get_execution_output, list_scheduled_tasks, create_scheduled_task, update_scheduled_task, delete_scheduled_task'
    : 'create_project, search_files, read_file, list_dir, recall, remember, forget, write_file, list_chats, read_chat, list_artifacts, read_artifact, web_search, web_fetch';

  return `You are a personal AI operator and orchestrator. You decide how work gets done — you never implement code, write files, or run git operations yourself when the task belongs to a coding agent.

## Core rules
- Auto-approved (do without asking): ${autoApproved}
- User-approved (proceed and the system handles the pause): git_op push, write_file, github_api write ops, delete_project, delete_scheduled_task
- If a task has multiple coordinated workstreams: call create_campaign first, then dispatch tasks with their campaign_task_id. Never dispatch parallel agents without a campaign tracking them.
- Never ask the user for permission on an auto-approved action — just do it.

## State awareness
Before starting work on a project you haven't touched recently:
- Call list_campaigns to check past campaigns — avoid recreating work that already exists or is running.
- Call list_artifacts to see what's already been produced before generating a new report or research output.
- If a campaign shows status 'error', use resume_campaign to reset failed tasks and re-dispatch only those — don't create a duplicate campaign.

## MCP connections
Before calling mcp_call, use list_connections to discover available MCP servers and their tool names. Never guess a connection_id or tool name. Use test_connection to verify an MCP server is reachable before dispatching dependent work.

## File search
Use search_files for fast codebase lookups (finding where a function is defined, tracing usages, locating config). Only fall back to project_query for broad architectural questions that need reasoning across the whole codebase.`;
}

function researchBlock(): string {
  return `## Research discipline
web_search returns snippet previews only — always follow with web_fetch to read the full page before drawing conclusions.
Use recall before searching; the answer may already be in memory.
When a coding task requires external knowledge (library APIs, patterns, examples): complete the research pass first and include findings in the agent brief.`;
}

function domainBlock(intent: Intent): string {
  switch (intent.domain) {
    case 'code':
      return `## Coding tasks
worktree isolation: coding agents work on an isolated branch — the user's main checkout is never touched.

Scoping rules — choose the right unit of work:
- One coherent feature with clear scope → one ambitious invoke_claude_code prompt (describe what exists, what to build, what "done" means including tests passing)
- Independent parallel workstreams → campaign with parallel tasks
- Strict ordering (e.g. schema → API → frontend) → campaign with sequenced tasks
- Never break a coherent task into multiple small round-trips — it wastes context and loses continuity

Sub-agent model hints (pass as model param to invoke_claude_code):
- 'haiku': trivial edits, single-file changes
- 'sonnet': standard feature work (default)
- 'opus': architectural decisions, large refactors, complex multi-file reasoning

Agent brief quality: always include — what already exists (from project_query, search_files, or research), what to build, and what "done" means.

Result evaluation: after invoke_claude_code or invoke_codex returns, read the result for failure signals (test failures, errors, "could not", partial completion). If present, send a targeted follow-up correction before committing. On confirmed success: run git_op add then git_op commit. Do not ask permission to commit.

Choosing invoke_claude_code vs invoke_codex: pick whichever fits the task best — both are capable coding agents. Use the agent usage section to weigh cost/budget when the two are otherwise a toss-up, and consider a parallel second approach (one task on each) for tasks that benefit from comparing two independent implementations.`;

    case 'writing':
      return `## Writing tasks
Use write_file for output to save; respond inline for drafts the user has not asked to save.
Confirm path and project with the user before writing any file.
Do not invoke coding agents for writing, documentation, or note-taking tasks.`;

    case 'research':
      return `## Research tasks
Always read the full source — web_search alone is insufficient, always follow with web_fetch.
Cite sources in your response.
Check recall first before any web search.`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_file when the user wants output saved.
Research often improves creative work — check for relevant context before generating.`;

    case 'multi':
      return `## Multi-domain tasks
Always use create_campaign to track coordinated work before dispatching any tasks.
Suggested order: research → setup → implementation → verification → git → github.`;

    default:
      return '';
  }
}

function projectContextBlock(project: DbProject): string {
  const caps = detectCapabilities(project.id, project.repo_path);
  const capLabels: string[] = [];
  if (caps.has_remotion) capLabels.push('remotion (can call generate_video)');
  if (caps.has_media) capLabels.push('rendered media available in Artifacts tab');
  if (caps.has_graph) capLabels.push('code graph indexed — use project_query for broad codebase questions before reading individual files');
  if (caps.has_research) capLabels.push(`research notes exist — read them with read_file/list_dir from ${path.join(getDataDir(), 'projects', project.id, 'research')} before starting new research`);

  const header = `## Active project: **${project.name}** (id: ${project.id})${project.description ? ' — ' + project.description : ''}`;

  let guidance: string;
  if (project.repo_path) {
    const capNote = capLabels.length > 0
      ? ` Detected capabilities: ${capLabels.join(', ')}.`
      : ' No special capabilities detected yet.';
    const scaffoldNote = !caps.has_remotion
      ? ' To add video generation: delegate to invoke_claude_code to scaffold a Remotion setup (create remotion/ directory with package.json, composition, and index).'
      : '';
    guidance = `\nCode project (repo: ${project.repo_path}).${capNote}${scaffoldNote} Delegate coding tasks to invoke_claude_code or invoke_codex with full context. Use git_op add→commit after work completes. For non-code tasks (docs, notes), use write_file/read_file directly.`;
  } else {
    guidance = `\nDoc/writing project (no git repo). Use write_file/read_file/list_dir directly — no Claude Code or Codex needed.`;
  }

  const workspaceMd = readWorkspaceMd(project);
  const workspaceSection = workspaceMd
    ? `\n\n### workspace.md\n${workspaceMd}\n\n_Update workspace.md after significant progress, decisions, or completed milestones._`
    : `\n\n_No workspace.md yet. Use write_file to create workspace.md in the project root to record current goals, decisions, and progress for future sessions._`;

  return header + guidance + workspaceSection;
}

function memoryBlock(userId: string, intent: Intent, pinnedProjectId?: string): string {
  const entries = recallRelevant(userId, intent, pinnedProjectId);
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
  const projects = getDb()
    .prepare('SELECT id, name, description, repo_path FROM projects WHERE user_id = ?')
    .all(userId) as Array<{ id: string; name: string; description: string | null; repo_path: string | null }>;
  if (projects.length === 0) return 'No projects yet.';
  return `Available projects:\n${projects.map(p => `- ${p.name} (id: ${p.id}${p.repo_path ? '' : ', no repo'})${p.description ? ': ' + p.description : ''}`).join('\n')}`;
}

function formatUsageLine(label: string, spent: number, budget: number | null): string {
  if (budget === null) return `- ${label}: $${spent.toFixed(2)} spent (no budget set)`;
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : 100;
  return `- ${label}: $${spent.toFixed(2)} / $${budget.toFixed(2)} used (${pct}%)`;
}

function usageBlock(userId: string): string {
  const budgets = getAgentBudgets(userId);
  const claudeSpent = getMonthlyUsage(userId, 'claude_code');
  const codexSpent = getMonthlyUsage(userId, 'codex');
  return `## Agent usage this month
${formatUsageLine('Claude Code (invoke_claude_code)', claudeSpent, budgets.claude_code)}
${formatUsageLine('Codex (invoke_codex)', codexSpent, budgets.codex)}
When a budget is set and nearly exhausted, route routine work to the other agent and reserve the constrained one for tasks where it's clearly the better fit. Once a budget is fully used, that agent's tool will return an error instead of running until the next month or until the budget is raised in Settings.`;
}

function sessionSummaryBlock(sessionId: string): string {
  const row = getDb()
    .prepare('SELECT summary FROM sessions WHERE id = ?')
    .get(sessionId) as { summary: string | null } | undefined;
  if (!row?.summary) return '';
  return `Earlier in this session:\n${row.summary}`;
}

// ─── Public API ────────────────────────────────────────────────────────────

export function buildContext(userId: string, sessionId: string, intent: Intent): string {
  const session = getDb()
    .prepare('SELECT pinned_project_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_project_id: string | null } | undefined;
  const pinnedProjectId = session?.pinned_project_id ?? undefined;

  const pinnedProject = pinnedProjectId
    ? getDb().prepare('SELECT id, name, description, repo_path, enabled_connection_ids FROM projects WHERE id = ?')
        .get(pinnedProjectId) as DbProject | undefined
    : undefined;

  const blocks: string[] = [
    baseBlock(intent),
    researchBlock(),
  ];

  const domain = domainBlock(intent);
  if (domain) blocks.push(domain);

  if (pinnedProject) blocks.push(projectContextBlock(pinnedProject));

  if (intent.domain === 'code' || intent.domain === 'multi') blocks.push(usageBlock(userId));

  blocks.push(memoryBlock(userId, intent, pinnedProjectId));
  blocks.push(projectsListBlock(userId));

  const chats = recentChatsBlock(userId, sessionId);
  if (chats) blocks.push(chats);

  const summary = sessionSummaryBlock(sessionId);
  if (summary) blocks.push(summary);

  return blocks.join('\n\n');
}

// ─── Tool subsetting ───────────────────────────────────────────────────────

const SHARED = [
  'remember', 'recall', 'forget',
  'list_chats', 'read_chat',
  'register_artifact', 'list_artifacts', 'read_artifact',
  'list_connections', 'test_connection',
  'search_files', 'read_file', 'list_dir',
  'create_project', 'update_project',
  'web_search', 'web_fetch',
];

const SCHEDULED = [
  'list_scheduled_tasks', 'create_scheduled_task', 'update_scheduled_task', 'delete_scheduled_task',
];

const TOOL_SETS: Record<string, string[]> = {
  code: [
    'invoke_claude_code', 'invoke_codex', 'git_op', 'github_api',
    'project_query', 'rebuild_graph',
    'create_campaign', 'resume_campaign', 'list_campaigns', 'get_campaign', 'get_execution_output',
    'write_file', 'create_artifact', 'generate_video',
    'mcp_call',
    ...SCHEDULED,
    ...SHARED,
  ],
  writing: [
    'write_file', 'create_artifact',
    ...SCHEDULED,
    ...SHARED,
  ],
  research: [
    'write_file', 'create_artifact',
    ...SCHEDULED,
    ...SHARED,
  ],
  creative: [
    'write_file', 'create_artifact', 'generate_video',
    ...SCHEDULED,
    ...SHARED,
  ],
};

export function getToolSubset(intent: Intent): Anthropic.Tool[] {
  const allowed = TOOL_SETS[intent.domain];
  if (!allowed) return toolDefinitions; // multi, general, image → all tools
  return toolDefinitions.filter(t => allowed.includes(t.name));
}
