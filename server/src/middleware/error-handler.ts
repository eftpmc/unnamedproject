import type { Request, Response, NextFunction, RequestHandler, Router } from 'express';
import { logger } from '../lib/logger.js';

/**
 * Wraps an async route handler so a rejected promise is forwarded to Express's
 * error handler instead of becoming an unhandled rejection that leaves the
 * request hanging (Express 4 does not catch async errors on its own).
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

interface RouteLayer { handle: RequestHandler }
interface RouterStackLayer { route?: { stack: RouteLayer[] } }

/**
 * Applies asyncHandler to every handler registered on a router, so async
 * rejections (and sync throws) reach the central error handler without wrapping
 * each handler by hand. Mutates handlers in place to preserve Express's Layer
 * instances. Call once per router at mount time. Error handlers (arity 4) are
 * left untouched.
 */
export function wrapAsyncErrors<T extends Router>(router: T): T {
  for (const layer of (router as unknown as { stack: RouterStackLayer[] }).stack) {
    if (!layer.route) continue;
    for (const handlerLayer of layer.route.stack) {
      if (typeof handlerLayer.handle === 'function' && handlerLayer.handle.length < 4) {
        handlerLayer.handle = asyncHandler(handlerLayer.handle);
      }
    }
  }
  return router;
}

/** Terminal middleware for requests that matched no route. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

interface HttpError {
  status?: number;
  statusCode?: number;
}

/**
 * Central error handler. Logs the failure with its stack and returns a JSON
 * error. Server-side (5xx) details are hidden in production so stack traces and
 * internal messages don't leak to clients.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const raw = (err as HttpError).status ?? (err as HttpError).statusCode ?? 500;
  const status = raw >= 400 && raw < 600 ? raw : 500;
  const message = err instanceof Error ? err.message : 'Internal server error';

  logger.error(`${req.method} ${req.path} failed`, {
    status,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });

  if (res.headersSent) return; // response already started; nothing safe to send
  const exposeMessage = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({ error: exposeMessage ? message : 'Internal server error' });
}
