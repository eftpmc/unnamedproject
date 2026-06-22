import fs from 'fs';
import path from 'path';
import { getDb, getAgentBudgets, getMonthlyUsage, getDailyUsage, getDataDir, getPermissionProfile, type DbProject } from '../db/index.js';
import { recallRelevant } from './memory.js';
import { formatEntry } from '../tools/memory_tools.js';
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
    ? 'invoke_claude_code, invoke_codex, generate_video, git_op add/commit, run_command, create_project, update_project, project_query, rebuild_graph, search_files, read_file, list_dir, recall, remember, forget, list_chats, read_chat, register_artifact, list_artifacts, read_artifact, list_connections, test_connection, tool_search, create_plan, resume_plan, list_plans, get_plan, get_execution_output, list_scheduled_tasks, create_scheduled_task, update_scheduled_task'
    : 'create_project, search_files, read_file, list_dir, recall, remember, forget, write_file, run_command, list_chats, read_chat, list_artifacts, read_artifact, list_connections, test_connection, tool_search';

  return `You are a personal AI operator and orchestrator. You decide how work gets done — you never implement code, write files, or run git operations yourself when the task belongs to a coding agent.

## Core rules
- Auto-approved (do without asking): ${autoApproved}
- User-approved (proceed and the system handles the pause): git_op push, delete_project, delete_scheduled_task
- write_file auto-approves on fast/trusted profiles; on strict it pauses for user approval like any other tool
- If a task has multiple coordinated workstreams: call create_plan first, then dispatch steps with their plan_step_id. Never dispatch parallel agents without a plan tracking them.
- Never ask the user for permission on an auto-approved action — just do it.
- After any invoke_claude_code or invoke_codex succeeds: immediately run git_op add then git_op commit. This is mandatory. Never ask "should I commit?" or "would you like me to commit?" — that question is a protocol violation. Commit first, summarize after.

## State awareness
Before starting work on the active project, check what already exists there:
- Call list_plans with the active project_id — avoid recreating plans that already exist or are running.
- Call list_artifacts with the active project_id — see what's already been produced before generating a new report or research output.
- If a plan shows status 'error', use resume_plan to reset failed steps and re-dispatch only those — don't create a duplicate plan.
Only check other projects when the user's request explicitly involves them.

## MCP connections
GitHub, web search, and other external service integrations are provided through MCP servers configured in Settings → MCP. To use an MCP tool, first use tool_search to discover available tools by describing what you need, or use list_connections to see all configured servers and their tools. Never guess a connection_id or tool name. Use test_connection to verify an MCP server is reachable before dispatching dependent work. If the user asks you to do something that requires GitHub or web search and no suitable MCP is configured, tell them which type of MCP server to add (e.g. GitHub MCP for repo/PR/issue operations, a search MCP like Brave or Exa for web research).

## File search
Use search_files for fast codebase lookups (finding where a function is defined, tracing usages, locating config). Only fall back to project_query for broad architectural questions that need reasoning across the whole codebase.`;
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
- Independent parallel workstreams → plan with parallel steps
- Strict ordering (e.g. schema → API → frontend) → plan with sequenced steps
- Never break a coherent task into multiple small round-trips — it wastes context and loses continuity
- Quick checks (run tests, inspect git log, list files, check a process) → run_command directly; do not spin up a coding agent for a one-liner

Sub-agent model hints (pass as model param to invoke_claude_code):
- 'haiku': trivial edits, single-file changes
- 'sonnet': standard feature work (default)
- 'opus': architectural decisions, large refactors, complex multi-file reasoning

Agent brief quality: always include — what already exists (from project_query, search_files, or research), what to build, and what "done" means.

Plan step chaining: when a plan step runs, the system automatically injects the results of all previously completed steps in the same plan into the agent's prompt. You do not need to manually relay prior results — just write each step's brief as if the agent will have access to what came before. For sequenced plans, write the dependent step's prompt to say "build on the prior step's output" or similar — the injected context will provide the actual content.

## Mandatory post-coding flow (every invoke_claude_code or invoke_codex call)
After the agent returns, always follow this exact sequence — do not skip any step:
1. Read the result for failure signals (test failures, errors, "could not", partial completion). If present, send a targeted follow-up correction, then repeat from step 1.
2. Run git_op with op=add (project_id = same project). No permission needed.
3. Run git_op with op=commit, message describing what was done. No permission needed.
4. Only after the commit is confirmed: report to the user and summarize what changed.

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
Check recall first before any web search.`;

    case 'creative':
      return `## Creative tasks
Respond inline for short creative work. Use write_file when the user wants output saved.
Research often improves creative work — check for relevant context before generating.`;

    case 'multi':
      return `## Multi-domain tasks
Always use create_plan to track coordinated work before dispatching any steps.
Suggested order: research → setup → implementation → verification → git → github.

Plan step chaining: prior step results are automatically injected into each subsequent step's prompt. Write each step brief assuming the agent will have full context from steps that ran before it — no need to manually pass outputs forward.`;

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

function formatUsageLine(label: string, spent: number, budget: number | null, dailySpent: number, dailyBudget: number | null): string {
  const monthly = budget === null
    ? `$${spent.toFixed(2)} spent (no monthly budget)`
    : `$${spent.toFixed(2)} / $${budget.toFixed(2)} used this month (${budget > 0 ? Math.round((spent / budget) * 100) : 100}%)`;
  const daily = dailyBudget === null
    ? `$${dailySpent.toFixed(2)} spent today (no daily budget)`
    : `$${dailySpent.toFixed(2)} / $${dailyBudget.toFixed(2)} used today (${dailyBudget > 0 ? Math.round((dailySpent / dailyBudget) * 100) : 100}%)`;
  return `- ${label}: ${monthly}; ${daily}`;
}

function usageBlock(userId: string): string {
  const budgets = getAgentBudgets(userId);
  const dailyBudgets = getAgentBudgets(userId, 'daily');
  const claudeSpent = getMonthlyUsage(userId, 'claude_code');
  const codexSpent = getMonthlyUsage(userId, 'codex');
  const claudeSpentToday = getDailyUsage(userId, 'claude_code');
  const codexSpentToday = getDailyUsage(userId, 'codex');
  return `## Agent usage
${formatUsageLine('Claude Code (invoke_claude_code)', claudeSpent, budgets.claude_code, claudeSpentToday, dailyBudgets.claude_code)}
${formatUsageLine('Codex (invoke_codex)', codexSpent, budgets.codex, codexSpentToday, dailyBudgets.codex)}
When a budget is set and nearly exhausted, route routine work to the other agent and reserve the constrained one for tasks where it's clearly the better fit. Once a budget is fully used, that agent's tool will return an error instead of running until the budget resets (daily budgets reset at UTC midnight, monthly budgets reset on the 1st) or until the budget is raised in Settings.`;
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
    permissionBlock(userId),
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
