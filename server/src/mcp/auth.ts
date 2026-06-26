import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/secrets.js';

export const MCP_TOKEN_EXPIRY_SECS = 3600;

export function generateMcpToken(userId: string, sessionId?: string | null): string {
  return jwt.sign({ userId, sessionId: sessionId ?? null, scope: 'mcp' }, getJwtSecret(), { expiresIn: MCP_TOKEN_EXPIRY_SECS });
}

export function verifyMcpToken(token: string): { userId: string; sessionId: string | null } {
  const payload = jwt.verify(token, getJwtSecret()) as { userId?: string; sessionId?: string | null; scope?: string };
  if (payload.scope !== 'mcp' || !payload.userId) throw new Error('Invalid mcp token scope');
  return { userId: payload.userId, sessionId: payload.sessionId ?? null };
}
