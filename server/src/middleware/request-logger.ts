import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Logs one line per completed request: method, path, status, and duration.
 * Uses req.path (not the full URL) so query-string tokens are never logged.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const meta = { status: res.statusCode, ms: Date.now() - start };
    const line = `${req.method} ${req.path}`;
    if (res.statusCode >= 500) logger.error(line, meta);
    else if (res.statusCode >= 400) logger.warn(line, meta);
    else logger.info(line, meta);
  });
  next();
}
