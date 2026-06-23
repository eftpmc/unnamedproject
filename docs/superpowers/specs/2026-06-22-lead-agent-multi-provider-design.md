# Lead Agent Multi-Provider Support

**Date:** 2026-06-22
**Status:** Approved

## Goal

Allow the lead agent to run on any of three provider backends — Anthropic (Claude), OpenAI (GPT-4o, GPT-5, etc.), or a local OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp) — configured per user via the Settings UI. The primary motivation is enabling the lead agent to run on 8–12 GB VRAM local hardware using smaller models (e.g. Qwen2.5 14B).

## Architecture

A provider interface is extracted from `runAgentTurn()`. The turn loop (tool dispatch, approval handling, session events, retry logic) stays entirely unchanged. Only the ~30 lines that instantiate the Anthropic client and call `client.messages.stream()` are replaced with `provider.stream()`.

```
LeadAgentProvider (interface)
├── AnthropicProvider   — wraps existing Anthropic SDK streaming (zero behavior change)
├── OpenAIProvider      — calls api.openai.com via OpenAI SDK
└── LocalProvider       — calls a custom baseURL via the same OpenAI SDK
```

`OpenAIProvider` and `LocalProvider` are the same class parameterized by `baseURL`. OpenAI uses the SDK default; local overrides it. Both share the same Anthropic ↔ OpenAI format translation layer.

## Provider Interface

```ts
interface LeadAgentProvider {
  stream(params: {
    model: string;
    system: string;
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
  }): Promise<{
    contentBlocks: Anthropic.ContentBlock[];
    inputTokens: number;
    outputTokens: number;
  }>;
  resolveModel(
    session: { model: string | null } | undefined,
    intent: Intent,
    effort: EffortLevel
  ): Promise<string>;
}
```

Inputs and outputs stay in **Anthropic format** throughout the turn loop. Translation happens inside the OpenAI/Local provider, invisible to the caller.

## Format Translation (Anthropic ↔ OpenAI)

### Tools (outgoing)
```
Anthropic: { name, description, input_schema: { type, properties, required } }
OpenAI:    { type: 'function', function: { name, description, parameters: { type, properties, required } } }
```

### Messages (outgoing)
- Anthropic assistant messages with `tool_use` content blocks → OpenAI `tool_calls` on the assistant message
- Anthropic user messages with `tool_result` content blocks → OpenAI `role: 'tool'` messages (one per result)
- Text content blocks → `content` string

### Response (incoming)
- OpenAI `tool_calls` deltas → Anthropic `tool_use` content blocks (accumulate `arguments` JSON string, parse to `input` object)
- OpenAI text deltas → Anthropic `text` content blocks
- OpenAI `finish_reason: 'tool_calls'` → `stop_reason: 'tool_use'`
- OpenAI usage → `input_tokens` / `output_tokens`

## Model Resolution

| Provider | Resolution |
|----------|-----------|
| Anthropic | Existing `resolveModelForTurn()` — lists Claude models from API, maps effort to tier |
| OpenAI | Model name from connection config (e.g. `gpt-4o`). If session has a pinned model, use that. |
| Local | Model name from connection config (e.g. `qwen2.5:14b`). Pinned session model overrides. |

## Data Model

Three connection configurations for `lead_agent` purpose:

| Provider | `type` | encrypted config fields |
|----------|--------|------------------------|
| Claude | `anthropic` | `{ apiKey }` — unchanged |
| OpenAI | `openai` | `{ apiKey, modelName }` |
| Local | `local` | `{ baseUrl, modelName, apiKey? }` |

### DB Changes
- Add `'local'` to the `connections.type` CHECK constraint via migration
- Relax `PURPOSE_TYPE` enforcement in `connections.ts` so `lead_agent` accepts `anthropic`, `openai`, or `local`

### Priority
Only one `lead_agent` connection is active at a time. Selection order: `lead_agent`-purpose first, then `created_at` descending (most recent wins). Same logic as today.

### `getLeadAgentConnection()`
Replaces `getAnthropicKey()` for the lead agent path. Returns a typed union:
```ts
type LeadAgentConnection =
  | { type: 'anthropic'; apiKey: string }
  | { type: 'openai'; apiKey: string; modelName: string }
  | { type: 'local'; baseUrl: string; modelName: string; apiKey?: string };
```

## Settings UI

The lead agent setup card gains a **provider picker** before the credential fields:

```
[ Claude (Anthropic) ]  [ OpenAI ]  [ Local Model ]
```

**Claude**: Anthropic API key — existing behavior, visually unchanged.

**OpenAI**: API key field + model name input (default placeholder: `gpt-4o`).

**Local Model**: Base URL field (placeholder: `http://localhost:11434/v1`) + model name (placeholder: `qwen2.5:14b`) + optional API key field.

**Test connection** works for all three:
- Anthropic: existing ping to Anthropic models endpoint
- OpenAI: GET `api.openai.com/v1/models` with the key
- Local: GET `{baseUrl}/models` — success if reachable (200 or non-auth error)

## Files Changed

| File | Change |
|------|--------|
| `server/package.json` | Add `openai` SDK dependency |
| `server/src/db/index.ts` | Add `'local'` to type CHECK; write migration |
| `server/src/routes/connections.ts` | Relax `PURPOSE_TYPE` for `lead_agent`; validate new config fields for openai/local types |
| `server/src/services/lead_agent_providers.ts` | **New file**: interface, AnthropicProvider, OpenAICompatibleProvider, format translation, `getLeadAgentProvider()` factory |
| `server/src/services/anthropic.ts` | Add `getLeadAgentConnection()` returning typed union; keep `getAnthropicKey()` for coding-agent paths |
| `server/src/services/agent.ts` | Replace hardcoded Anthropic client setup in `runAgentTurn()` with `getLeadAgentProvider(userId)` |
| `web/src/pages/Settings.tsx` | Provider picker + conditional fields for lead agent setup kind |

## Out of Scope

- Fallback between providers on failure (if local fails, do not auto-retry on Anthropic)
- Per-session provider override (provider is per-user, not per-chat)
- Model listing/picker for OpenAI or local (user types the model name)
- System prompt tuning for small models (separate task)
- CORE_TOOLS reduction for small models (separate task)
