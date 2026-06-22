import { toolDefinitions } from '../tools/definitions.js';
import { getRegistrySearchPool } from './toolRegistry.js';

export const EXCLUDED_FROM_SEARCH = new Set(['tool_search', 'delegate_to_agent']);

interface SearchCandidate {
  name: string;
  description: string;
}

function score(query: string, candidate: SearchCandidate): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${candidate.name} ${candidate.description}`.toLowerCase();
  let matched = 0;
  for (const term of terms) {
    if (haystack.includes(term)) matched++;
  }
  return matched;
}

export function searchTools(userId: string, query: string, limit = 5): Array<{ name: string; description: string }> {
  const firstParty: SearchCandidate[] = toolDefinitions
    .filter(t => !EXCLUDED_FROM_SEARCH.has(t.name))
    .map(t => ({ name: t.name, description: t.description ?? '' }));

  const mcp = getRegistrySearchPool(userId);

  const pool = [...firstParty, ...mcp];

  return pool
    .map(c => ({ candidate: c, score: score(query, c) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => r.candidate);
}
