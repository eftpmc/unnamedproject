import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../lib/secrets.js';

export const MCP_TOKEN_EXPIRY_SECS = 3600;

export function generateMcpToken(userId: string): string {
  return jwt.sign({ userId, scope: 'mcp' }, getJwtSecret(), { expiresIn: MCP_TOKEN_EXPIRY_SECS });
}

export function verifyMcpToken(token: string): { userId: string } {
  const payload = jwt.verify(token, getJwtSecret()) as { userId?: string; scope?: string };
  if (payload.scope !== 'mcp' || !payload.userId) throw new Error('Invalid mcp token scope');
  return { userId: payload.userId };
}
