import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { rememberFact } from './memory.js';
import type { MemoryType } from './memory.js';

interface MemoryCandidate {
  type: MemoryType;
  key: string;
  value: string;
  space_id?: string;
}

const EXTRACT_SYSTEM = `You are a memory extractor. Review the conversation and identify facts worth persisting for future sessions. Return a JSON array of memory candidates — or an empty array [] if nothing new is worth saving.

Each candidate:
{"type":"user|feedback|project|reference","key":"short_snake_case_id","value":"the fact","space_id":"optional"}

Types:
- user: durable preferences or facts about the user or their environment
- feedback: corrections or process preferences about how the assistant should work
- project: decisions or notes tied to a specific Space (include space_id)
- reference: pointers to external systems (Slack channels, Linear projects, dashboards, etc.)

Only extract genuinely new and durable information. Do not re-extract things that are already common knowledge or temporary context. Return [] if nothing qualifies.`;

export async function extractAndRemember(userId: string, sessionId: string, apiKey: string): Promise<void> {
  const messages = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(sessionId) as Array<{ role: string; content: string }>;

  if (messages.length === 0) return;

  const session = getDb()
    .prepare('SELECT pinned_space_id FROM sessions WHERE id = ?')
    .get(sessionId) as { pinned_space_id: string | null } | undefined;

  const transcript = messages
    .reverse()
    .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
    .join('\n\n');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '[]';
    const candidates = JSON.parse(text) as MemoryCandidate[];

    for (const c of candidates) {
      if (!c.type || !c.key || !c.value) continue;
      const spaceId = c.space_id ?? session?.pinned_space_id ?? null;
      rememberFact(userId, c.type, c.key, c.value, spaceId);
    }
  } catch {
    // extraction is best-effort, never throw
  }
}
