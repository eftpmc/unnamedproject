# Orchestrator Redesign

**Date:** 2026-06-11
**Status:** Approved

## Goal

Transform the orchestrator from a flat prompt-driven dispatcher into a structured, intelligent routing layer that makes precise decisions about domain, model, tools, context, and agent scoping on every turn — while fully leveraging the power of Claude Code and Codex as capable autonomous agents rather than simple execution wrappers.

---

## Architecture Overview

Every turn flows through three phases before the main model runs:

```
User message
    │
    ├──[parallel]──────────────────────────────────────┐
    │                                                   │
    ▼                                                   ▼
Intent extraction (Haiku)                    Context assembly
  → domain, complexity,                        → relevant memories (filtered)
    model tier, tools hint,                    → project context block
    scope, needs_research                      → recent chats if needed
    ~150ms, ~$0.0003                                    │
    │                                                   │
    └──────────────────┬────────────────────────────────┘
                       ▼
            Assembled turn context
              base + domain block + research block +
              filtered memory + tool subset
                       ▼
            Main orchestrator turn
              (model chosen per-turn, not per-session)
                       ▼
            Tool dispatch (parallel where independent)
                       ▼
            [background, fire-and-forget]
              memory extraction (Haiku)
              session distillation check (every 20 turns)
```

The orchestrator never does work itself. It decides scope, frames work for agents, evaluates results, and follows up if needed.

---

## 1. Intent Extraction Pre-pass

A single Haiku call that runs in parallel with context assembly. Costs ~$0.0003 and adds ~0 wall-clock latency.

### Output schema

```ts
interface Intent {
  domain: 'code' | 'writing' | 'research' | 'creative' | 'image' | 'multi' | 'general';
  complexity: 'low' | 'medium' | 'high';
  model: 'haiku' | 'sonnet' | 'fable' | 'opus';
  tools: string[];           // hints, not hard restrictions
  scope: 'inline'            // respond directly, no delegation
       | 'delegate'          // hand to a single coding/creative agent
       | 'campaign';         // multi-step, decompose before dispatching
  needs_research: boolean;   // true → do web research before delegating
  ambiguous: boolean;        // true → use general defaults
}
```

### Fallback

If extraction fails or `ambiguous: true`: domain=general, complexity=medium, model=sonnet, all tools, needs_research=false. Never ask the user to clarify routing.

### Scope is the key signal

`scope` is what elevates the orchestrator from router to planner:
- `inline` → the orchestrator responds directly without tools or with lightweight tools only
- `delegate` → one well-framed, ambitious prompt to a coding or creative agent
- `campaign` → the task has multiple independent or sequenced workstreams; always decompose into a campaign before dispatching

---

## 2. Composable Context Blocks

The monolithic system prompt is replaced with a minimal base plus assembled blocks. Each block is injected only when relevant.

### `base` (always present, ~200 tokens)

- Identity: personal AI operator and dispatcher
- Core rule: never do work inline that belongs to an agent
- Core rule: if `scope=campaign`, always create the campaign before dispatching any tasks — never fire parallel agents untracked
- Approval tiers: auto-approved vs. user-approved actions
- Never ask for permission on auto-approved actions; never skip user-approved ones

### `research` (always present)

- `web_search` returns snippets only — always follow promising results with `web_fetch` to read the full page
- Before delegating to a coding agent on a task with `needs_research: true`, complete the research pass first and include findings in the agent brief
- Use `recall` before searching — the answer may already be in memory

### `domain:code`

- Worktree isolation: coding agents work on an isolated branch, the main checkout is never touched
- **Scoping rules:**
  - One coherent feature with clear boundaries → one ambitious `invoke_claude_code` call with full context
  - Independent parallel workstreams → campaign with parallel tasks
  - Strict ordering (schema → API → frontend) → campaign with sequenced tasks
  - Never break a single coherent task into multiple small round-trips
- **Sub-agent model selection:** pass a `model` hint based on task complexity
  - Haiku: trivial edits, single-file changes
  - Sonnet: standard feature work
  - Opus: architectural decisions, large refactors, complex multi-file reasoning
- **Framing quality:** the agent brief must include — what already exists (from project_query or prior research), what to build, what "done" means (tests pass, specific files created, etc.)
- **Result evaluation:** after a coding agent returns, check for failure signals (test failures, errors, partial completion). If found, send a targeted follow-up correction call before committing. Don't commit and report done on a failed result.
- After confirmed success: `git_op add` → `git_op commit` with a descriptive message. No user permission needed.
- Prefer `invoke_claude_code`. Use `invoke_codex` for OpenAI preference or a parallel second approach.

### `domain:writing`

- Use `write_file` directly — no coding agents
- Confirm path and project with the user before writing
- For drafts and exploration, respond inline; only write to file when the user wants it saved

### `domain:research`

- Always use `web_fetch` to read full pages after `web_search`
- Cite sources in the response
- Use `recall` before any web search

### `domain:creative`

- For text creative output: use `write_file` when saving is needed, respond inline for drafts
- Image generation: use `image_gen` tool when available (future)
- Research is often valuable before creative work — check `needs_research`

### `domain:multi`

- Always use `create_campaign` to track coordinated work
- Order tasks: research → setup → implementation → verification → git → github
- Don't dispatch tasks before the campaign is created

### `project_context` (when project is pinned)

- Project name, ID, type (code repo vs. doc project)
- For code: repo path, guidance to use coding agents
- For docs: use file ops directly, no coding agents

---

## 3. Per-turn Model Routing

Model is chosen per-turn based on intent extraction. Session `effort` becomes a ceiling, not a floor.

### Routing table

| Domain + Complexity | Default Model |
|---|---|
| any + low | Haiku |
| code + medium | Sonnet |
| research + medium | Sonnet |
| writing + medium | Sonnet |
| creative + medium | Sonnet |
| code + high | Fable |
| creative + high | Fable |
| writing + high | Fable |
| reasoning/analysis + high | Opus |
| general / ambiguous | Sonnet |

### Session effort as ceiling

| Session effort | Max model |
|---|---|
| low | Haiku |
| medium | Sonnet |
| high | no restriction |

Explicit session `model` override always wins over the routing table.

---

## 4. Tool Subsetting

Tools exposed per domain. Reduces noise and improves model accuracy. Research tools (`web_search`, `web_fetch`, `recall`) are always included — they're universal.

| Domain | Tools |
|---|---|
| code | invoke_claude_code, invoke_codex, git_op, github_api, project_query, rebuild_graph, create_campaign, read_file, list_dir, write_file, create_project, update_project, remember, recall, forget, read_chat, web_search, web_fetch |
| writing | write_file, read_file, list_dir, create_project, update_project, web_search, web_fetch, remember, recall, forget, read_chat |
| research | web_search, web_fetch, recall, remember, forget, read_chat, read_file, write_file |
| creative | write_file, read_file, create_project, web_search, web_fetch, remember, recall, forget, read_chat |
| multi | all tools |
| general | all tools |

MCP tools always included when connections exist.

---

## 5. Memory Redesign

### Selective recall

All memories are no longer dumped into every turn. Before context assembly, memories are scored against the current intent:

- `feedback` memories: always included (they govern behavior)
- `project` memories: include only entries for the pinned project
- `user` memories: score against detected domain and tools hint; include top-N by relevance (N=10 default)
- `reference` memories: include only if tools_hint or domain suggests external systems are involved

### Automatic extraction

After each turn, a fire-and-forget Haiku call inspects the conversation and extracts anything worth persisting: user preferences revealed, project decisions made, corrections given, external systems referenced. Writes to memory directly. The orchestrator doesn't have to decide to call `remember` — extraction is automatic.

### Session distillation

After 20 turns in a session, a background job:
1. Summarizes the session into a brief narrative
2. Writes it as a `project` memory entry (or `user` if no project is involved)
3. Sets a `summary` field on the session row
4. The message history passed to the API becomes: session summary + last 10 turns
5. Repeats every 10 turns thereafter (turn 30, 40, 60, etc.) — the summary is always replaced with a fresh one covering the full session

Older messages are retained in the DB but dropped from live context. This keeps long sessions from becoming expensive or hitting context limits.

### Memory schema

No changes to the 4-type schema (user/feedback/project/reference) — the structure is clean. All improvements are in how memories are loaded and written, not how they're stored.

---

## 6. Implementation Notes

### New files

- `server/src/services/intent.ts` — intent extraction pre-pass
- `server/src/services/context.ts` — context block assembly, replaces `buildSystemPrompt` in agent.ts
- `server/src/services/distill.ts` — session distillation background job
- `server/src/services/extract-memory.ts` — automatic memory extraction background job

### Modified files

- `server/src/services/agent.ts` — wire intent extraction and context assembly, per-turn model routing, result evaluation loop
- `server/src/services/memory.ts` — add relevance scoring / selective recall
- `server/src/tools/definitions.ts` — no schema changes; tool subsetting happens at assembly time
- `server/src/db/index.ts` — add `summary` column to sessions table

### What does NOT change

- Tool schemas (definitions.ts structures stay the same)
- The `dispatchTool` switch — tool execution logic is untouched
- Worktree isolation, campaign tracking, execution logging
- The 4-type memory schema
- Session effort/model/pinned_project_id fields
- Claude Code and Codex invocation logic

---

## 7. Open Items (out of scope for this spec)

- `image_gen` tool: integrate image generation API (DALL-E, Replicate, Flux) — requires its own spec
- Semantic memory search: fuzzy/embedding-based recall beyond keyword matching
- Campaign conditional branching: task dependencies beyond sequential ordering
- Multi-session memory threads: linking related sessions into a project memory arc
