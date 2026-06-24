import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db/index.js';
import { rememberFact } from './memory.js';

export function getTurnCount(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
    .get(sessionId) as { count: number };
  return row.count;
}

export function shouldDistill(sessionId: string): boolean {
  const count = getTurnCount(sessionId);
  if (count < 20) return false;
  return count === 20 || (count - 20) % 10 === 0;
}

const DISTILL_SYSTEM = `Summarize this conversation into a concise narrative (3–6 sentences) that captures: what the user is working on, key decisions made, and any important context a future session should know. Write in third person past tense. Be specific — include project names, tool choices, and outcomes where relevant.`;

export async function maybeDistill(userId: string, sessionId: string, apiKey: string): Promise<void> {
  if (!shouldDistill(sessionId)) return;

  const messages = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at')
    .all(sessionId) as Array<{ role: string; content: string }>;

  const transcript = messages
    .map(m => `${m.role}: ${m.content.slice(0, 800)}`)
    .join('\n\n');

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: DISTILL_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!summary) return;

    // Store on the session for context injection
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, sessionId);

    // Also persist as a memory entry so it survives session context limits
    const session = getDb()
      .prepare('SELECT pinned_space_id FROM sessions WHERE id = ?')
      .get(sessionId) as { pinned_space_id: string | null } | undefined;

    const spaceId = session?.pinned_space_id ?? null;
    const memType = spaceId ? 'project' : 'user';
    const memKey = `session_summary_${sessionId.slice(0, 8)}`;
    rememberFact(userId, memType, memKey, summary, spaceId);
  } catch {
    // distillation is best-effort, never throw
  }
}
