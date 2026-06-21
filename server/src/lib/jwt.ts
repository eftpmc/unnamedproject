import jwt from 'jsonwebtoken';
import { getJwtSecret } from './secrets.js';

// Tokens are signed with a per-install secret resolved by the secrets module:
// JWT_SECRET from the environment if set, otherwise a strong random secret
// generated and persisted on first run. It never falls back to a public
// constant, so tokens can't be forged on an unconfigured deployment.
const secret = getJwtSecret;

export function signToken(userId: string): string {
  return jwt.sign({ userId }, secret(), { expiresIn: '30d' });
}

export function verifyToken(token: string): { userId: string } {
  return jwt.verify(token, secret()) as { userId: string };
}
