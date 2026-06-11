import { getDb } from '../db/index.js';

const TRUNCATION_NOTE = '\n\n(Note: output truncated — use read_chat with a narrower time range if you need more)';

export function readChat(userId: string, chatId: string): string {
  const db = getDb();

  const session = db
    .prepare('SELECT id, title FROM sessions WHERE id = ? AND user_id = ?')
    .get(chatId, userId) as { id: string; title: string | null } | undefined;

  if (!session) return `Chat ${chatId} not found`;

  const msgs = db
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 100')
    .all(chatId) as { role: string; content: string }[];

  if (msgs.length === 0) return `Chat "${session.title ?? 'Untitled'}" has no messages.`;

  const hitMessageLimit = msgs.length === 100;
  let anyMessageTruncated = false;

  const body = msgs.map(m => {
    if (m.content.length > 1000) {
      anyMessageTruncated = true;
      return `[${m.role}]: ${m.content.slice(0, 1000)}`;
    }
    return `[${m.role}]: ${m.content}`;
  }).join('\n\n');

  const truncated = hitMessageLimit || anyMessageTruncated;
  return `Chat: "${session.title ?? 'Untitled'}"\n\n${body}${truncated ? TRUNCATION_NOTE : ''}`;
}
