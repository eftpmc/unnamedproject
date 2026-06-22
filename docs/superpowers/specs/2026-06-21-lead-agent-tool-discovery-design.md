# Lead Agent Tool Discovery — Design

## Problem

The lead agent (`server/src/services/agent.ts`) currently sends its full static tool list (40 first-party tools) on every turn (`agent.ts:1310`, `const tools = toolDefinitions`). Domain-based tool subsetting (`getToolSubset()` in `context.ts`) exists but is dead code — never called. `Intent.scope` (`inline`/`delegate`/`plan`) is computed by `classifyIntent()` but never read anywhere downstream.

This is fine at the current scale, but three axes are expected to grow together:
- First-party tools (native capabilities like `generate_video`, `create_pipeline`)
- MCP-connected external tools (currently hidden behind a single generic `mcp_call({connection_id, tool_name, args})` passthrough, discovered at runtime via `list_connections`/`test_connection`)
- Agent roles (currently one generic shape, spawned via `delegate_to_agent`)

Goals for the redesign: **scalability** (don't bloat the model's per-turn tool list or require static registration as the tool/connection count grows) and **correctness** (don't gate capability behind a brittle classifier — `intent.ts` is pure regex with no fallback for ambiguous input, and `ambiguous: true` currently has no effect).

## Non-goals

- Replacing or improving `intent.ts`'s regex classification for domain/complexity. It continues to drive prose framing blocks and model-tier selection (haiku/sonnet/opus) — unrelated concerns this spec doesn't touch. Flagged as a separate future risk, not addressed here.
- Defining new concrete agent roles (researcher, reviewer, etc.). This spec builds the roster mechanism only; today's roster has exactly one entry (the existing generic subagent via `delegate_to_agent`).
- Multi-tenant concerns. Single-user system; no per-tenant registry isolation needed.

## Architecture

Two separate capability surfaces, split by growth pattern and selection mechanism — following the precedent of Claude Code's own tool model (a small enum-selected `Agent` tool, vs. a large deferred/searchable tool catalog):

### Surface 1: Tools (first-party + MCP) — discovered via search

A unified **tool registry** is the source of truth for every callable tool, combining two ingestion sources:

- **First-party**: `definitions.ts` entries, loaded statically at boot. No change to authoring.
- **MCP**: when `test_connection` succeeds (or a connection is added), the MCP server's tool list — each with its own JSON schema, per the MCP protocol — is upserted into the registry, tagged with `connection_id`. This replaces today's blind `mcp_call` passthrough: each MCP tool gets a real, typed, individually-named entry instead of one opaque generic wrapper.

Registry entry shape:
```
{
  name: string            // e.g. "read_file", "github.create_pr"
  description: string     // used for keyword/fuzzy matching
  schema: JSONSchema      // Anthropic.Tool-compatible input schema
  source: 'first_party' | 'mcp'
  connection_id?: string  // present when source === 'mcp'
}
```

A new `tool_search` tool is added to the lead's **always-loaded core set**. Input: `{ query: string }`. It performs keyword/fuzzy matching against `name` + `description` across the registry and returns the top N (e.g. 5) matches as `{name, description}` pairs — not full schemas.

**Discovery → pin → reuse flow:**
1. Lead calls `tool_search({query})`, gets back candidate names + descriptions.
2. The dispatcher, on producing the `tool_search` result, immediately pins the *full* `Anthropic.Tool` schema for each returned candidate into that session's **discovered set** — it does not wait for the model to explicitly invoke a candidate before making it callable. This avoids a third round-trip just to fetch a schema after search.
3. The lead can then call any pinned tool by name on the same or a later turn.
4. The discovered set persists for the lifetime of the session (same store as conversation history, keyed by `sessionId`) — once surfaced, a tool never needs re-searching within that conversation.

Each turn's `tools` array sent to the Anthropic API = **always-loaded core set** ∪ **session's discovered set** ∪ `tool_search` itself. This replaces `agent.ts:1310`'s `const tools = toolDefinitions`.

**Always-loaded core set** (used nearly every turn per the existing base system prompt rules): `tool_search`, `recall`, `remember`, `read_file`, `search_files`, `list_dir`, `write_file`, `create_plan`.

### Surface 2: Agent roles — selected via enum, never searched

Agent roles are deliberately kept small and curated (per non-goals, one entry today). They are **not** part of the tool registry or `tool_search`. `delegate_to_agent` stays in (or near) the always-loaded core set, parameterized by a `role` field — today a single value, expandable to an enum as roles are added in future work.

Rationale for the split: mixing a small, curated roster into the same search index as a large, ever-growing tool catalog creates ambiguous ranking (a query like "look up the API docs" could plausibly match either a specific MCP tool or a research-agent role) and reintroduces a classify-before-you-can-act problem at a different layer. Search exists to solve "catalog too large to show in full" — that problem doesn't apply to a small, explicit roster, which is better served by a visible enum the model sees every turn.

## Migration of existing mechanisms

| Mechanism | Disposition |
|---|---|
| `mcp_call` | Removed as a model-facing tool. Underlying MCP execution code path is reused; each MCP tool now gets its own registry entry instead of one generic wrapper. |
| `list_connections` / `test_connection` | Kept, repurposed as registry ingestion triggers (on success, upsert that connection's tools) rather than model-facing discovery tools. |
| `delegate_to_agent` | Unchanged in shape; stays outside the registry/search surface per Surface 2. |
| `getToolSubset()` (`context.ts`) | Deleted — dead code, superseded by `tool_search`. |
| `Intent.scope` (`intent.ts`) | Deleted — dead, never read downstream. |
| `Intent.domain` / `complexity` | Unchanged — still drive prose framing and model-tier selection, orthogonal to tool visibility. |
| `agent.ts:1310` | Replaced with resolution of core set ∪ discovered set ∪ `tool_search`, computed at the top of each turn before the streaming loop. |

## Error handling

- `tool_search` with no matches → explicit empty result (e.g. `"No matching tools found, try rephrasing"`), not an error — lets the model retry with a different query.
- MCP connection goes stale/disconnects after its tools were ingested → registry entries are kept (so search still surfaces them); a dispatch failure due to the connection being down surfaces as a normal tool-execution error. A transient MCP outage must not silently make a capability undiscoverable.
- Model calls a tool by name not present in the session's pinned discovered set (hallucinated name, lost session state) → dispatcher falls back to checking the full registry directly before failing; if found, pins it then executes (self-healing) rather than hard-erroring.
- `test_connection` failure → no registry changes; existing connection-health error path unchanged.

## Testing

- Registry: ingesting first-party tools at boot; upserting MCP tools on `test_connection` success; re-ingestion on reconnect produces no duplicate entries.
- `tool_search` matching: known query → expected top-N ranking; empty-match case; agent roles never appear in results (confirms surface separation holds).
- Integration test on `agent.ts`: simulate a turn where the model calls `tool_search` then the discovered tool — verify the *next* API call's `tools` array contains the full schema for the newly discovered tool (the crux of the two-step flow).
- Regression test confirming removal of `getToolSubset`/`scope` doesn't break `context.ts`'s domain-based prose blocks (which still need `domain`/`complexity`, just not tool filtering).
