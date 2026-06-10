import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt.js';

export interface AuthedRequest extends Request {
  userId: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }
  try {
    const payload = verifyToken(header.slice(7));
    (req as AuthedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
