import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { getDecryptedConfig } from '../routes/connections.js';

export const DEFAULT_CLAUDE_MODEL = process.env.DEFAULT_CLAUDE_MODEL ?? 'claude-sonnet-4-6';
export const DEFAULT_EFFORT = 'medium';
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;

export type EffortLevel = typeof EFFORT_LEVELS[number];

export interface ClaudeModelInfo {
  id: string;
  display_name: string;
  created_at: string;
  supports_effort: boolean;
}

const MODEL_OVERRIDE_BY_EFFORT: Partial<Record<EffortLevel, string>> = {
  low: process.env.CLAUDE_MODEL_LOW,
  medium: process.env.CLAUDE_MODEL_MEDIUM,
  high: process.env.CLAUDE_MODEL_HIGH,
};

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && EFFORT_LEVELS.includes(value as EffortLevel);
}

export function getAnthropicKey(userId: string): string {
  const conn = getDb()
    .prepare(`
      SELECT id FROM connections
      WHERE user_id = ? AND type = 'anthropic'
      ORDER BY CASE purpose WHEN 'lead_agent' THEN 0 ELSE 1 END, created_at
      LIMIT 1
    `)
    .get(userId) as { id: string } | undefined;
  if (!conn) throw new Error('No Anthropic connection configured');
  const config = getDecryptedConfig(conn.id, userId);
  return config.apiKey;
}

const MODEL_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const modelListCache = new Map<string, { models: ClaudeModelInfo[]; expiresAt: number }>();

async function listClaudeModelsForClient(client: Anthropic, apiKey?: string): Promise<ClaudeModelInfo[]> {
  const cached = apiKey ? modelListCache.get(apiKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const page = await client.models.list();

  const models = page.data.map(model => {
    const capabilities = (model as unknown as { capabilities?: { effort?: Record<string, boolean> } }).capabilities;
    const effort = capabilities?.effort;
    return {
      id: model.id,
      display_name: model.display_name,
      created_at: model.created_at,
      supports_effort: Boolean(effort?.low && effort?.medium && effort?.high),
    };
  });

  if (apiKey) modelListCache.set(apiKey, { models, expiresAt: Date.now() + MODEL_LIST_CACHE_TTL_MS });
  return models;
}

export async function listClaudeModels(userId: string): Promise<ClaudeModelInfo[]> {
  const apiKey = getAnthropicKey(userId);
  return listClaudeModelsForClient(new Anthropic({ apiKey }), apiKey);
}

function familyRank(modelId: string, effort: EffortLevel): number {
  const id = modelId.toLowerCase();
  if (id.includes('mythos') || id.includes('preview')) return 99;

  const orderByEffort: Record<EffortLevel, string[]> = {
    low: ['haiku', 'sonnet', 'opus', 'fable'],
    medium: ['sonnet', 'opus', 'haiku', 'fable'],
    high: ['fable', 'opus', 'sonnet', 'haiku'],
  };
  const rank = orderByEffort[effort].findIndex(family => id.includes(family));
  return rank === -1 ? 50 : rank;
}

function rankModels(models: ClaudeModelInfo[], effort: EffortLevel): ClaudeModelInfo[] {
  return models
    .filter(model => model.id.startsWith('claude-'))
    .sort((a, b) => {
      const rankDiff = familyRank(a.id, effort) - familyRank(b.id, effort);
      if (rankDiff !== 0) return rankDiff;
      // Tiebreak within a family (or among unranked models): prefer the newest.
      return b.created_at.localeCompare(a.created_at);
    });
}

export async function resolveModelForEffort(client: Anthropic, effort: EffortLevel, apiKey?: string): Promise<string> {
  const override = MODEL_OVERRIDE_BY_EFFORT[effort];
  if (override) return override;

  try {
    const models = await listClaudeModelsForClient(client, apiKey);
    const ranked = rankModels(models, effort);
    return ranked[0]?.id ?? DEFAULT_CLAUDE_MODEL;
  } catch {
    return DEFAULT_CLAUDE_MODEL;
  }
}

const FAMILY_TIER: Record<string, number> = { haiku: 0, sonnet: 1, fable: 2, opus: 3 };
// high effort = no ceiling (tier 3); fable is reachable via intent.model='fable' explicitly
const MAX_TIER_BY_EFFORT: Record<EffortLevel, number> = { low: 0, medium: 1, high: 3 };
const TIER_FAMILY = ['haiku', 'sonnet', 'fable', 'opus'] as const;

// Per-million-token pricing by model family (input, output). Used for in-process SDK calls.
// Falls back to sonnet rates for unknown models.
const FAMILY_PRICING: Record<string, [number, number]> = {
  haiku:  [0.80,  4.00],
  sonnet: [3.00, 15.00],
  fable:  [5.00, 25.00],
  opus:   [15.00, 75.00],
};

export function tokensToUsd(modelId: string, inputTokens: number, outputTokens: number): number {
  const id = modelId.toLowerCase();
  const [inRate, outRate] = Object.entries(FAMILY_PRICING).find(([family]) => id.includes(family))?.[1]
    ?? FAMILY_PRICING.sonnet;
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
}

export async function resolveModelForTurn(
  client: Anthropic,
  intent: { model: string },
  effort: EffortLevel,
  apiKey?: string,
): Promise<string> {
  const intentTier = FAMILY_TIER[intent.model] ?? 1;
  const ceiling = MAX_TIER_BY_EFFORT[effort];
  const effectiveTier = Math.min(intentTier, ceiling);
  const family = TIER_FAMILY[effectiveTier];

  try {
    const models = await listClaudeModelsForClient(client, apiKey);
    const matching = models
      .filter(m => m.id.startsWith('claude-') && m.id.toLowerCase().includes(family))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (matching[0]) return matching[0].id;
    // Fallback: highest-ranked model at or below the effective tier
    const ranked = rankModels(models, effort).filter(m => {
      const tier = Object.entries(FAMILY_TIER).find(([fam]) => m.id.toLowerCase().includes(fam))?.[1] ?? 99;
      return tier <= effectiveTier;
    });
    return ranked[0]?.id ?? DEFAULT_CLAUDE_MODEL;
  } catch {
    return DEFAULT_CLAUDE_MODEL;
  }
}

/** Models worth offering for a given effort level, ranked best-first. */
export async function getModelsForEffort(userId: string, effort: EffortLevel): Promise<ClaudeModelInfo[]> {
  const apiKey = getAnthropicKey(userId);
  const models = await listClaudeModelsForClient(new Anthropic({ apiKey }), apiKey);
  return rankModels(models, effort).filter(model => familyRank(model.id, effort) < 50);
}
