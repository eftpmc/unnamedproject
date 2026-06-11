import { getDb } from '../db/index.js';

export function readChat(userId: string, chatId: string): string {
  const session = getDb()
    .prepare('SELECT id, title FROM sessions WHERE id = ? AND user_id = ?')
    .get(chatId, userId) as { id: string; title: string | null } | undefined;

  if (!session) return `Chat ${chatId} not found`;

  const msgs = getDb()
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 100')
    .all(chatId) as { role: string; content: string }[];

  if (msgs.length === 0) return `Chat "${session.title ?? 'Untitled'}" has no messages.`;

  const body = msgs.map(m => `[${m.role}]: ${m.content.slice(0, 1000)}`).join('\n\n');
  return `Chat: "${session.title ?? 'Untitled'}"\n\n${body}`;
}
