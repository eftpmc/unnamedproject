import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'http';
import { initDb, reconcileOrphanedExecutions, getDataDir, getDb, closeDb } from './db/index.js';
import { ensureSecrets, getSecretSources } from './lib/secrets.js';
import { logger } from './lib/logger.js';
import { requestLogger } from './middleware/request-logger.js';
import { notFoundHandler, errorHandler, wrapAsyncErrors } from './middleware/error-handler.js';
import { initSocket } from './services/socket.js';
import { startScheduler } from './services/scheduler.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import agentProvidersRoutes from './routes/agent-providers.js';
import settingsRoutes from './routes/settings.js';
import sessionsRoutes from './routes/sessions.js';
import messagesRoutes from './routes/messages.js';
import executionsRoutes from './routes/executions.js';
import memoryRoutes from './routes/memory.js';
import webhooksRoutes from './routes/webhooks.js';
import googleRoutes from './routes/google.js';
import mcpRouter from './mcp/index.js';
import projectsRoutes from './routes/projects.js';
import documentsRoutes from './routes/documents.js';
import triggersRoutes from './routes/triggers.js';
import mediaRoutes from './routes/media.js';

const PORT = process.env.PORT ?? '3000';
const NODE_ENV = process.env.NODE_ENV;

// Resolve secrets at boot: use env-provided values, otherwise generate and
// persist strong ones to DATA_DIR so a self-hoster gets a secure zero-config
// first run. Throws (and so aborts boot) only if a generated secret can't be
// persisted in production — running with a secret that won't survive a restart
// would silently log everyone out on the next deploy.
function initSecrets() {
  ensureSecrets();
  const src = getSecretSources();
  if (src.jwtSecret === 'generated') {
    logger.info(`Generated a JWT signing secret and saved it to ${getDataDir()}/secrets.json. Keep this file with your backups — deleting it logs everyone out.`);
  }
  if (src.jwtSecret === 'ephemeral') {
    logger.warn('Could not persist generated secrets — tokens will not survive a restart. Set JWT_SECRET or make DATA_DIR writable.');
  }

}

if (NODE_ENV !== 'test') initSecrets();

// A backstop only. Async route errors are forwarded to the error handler via
// asyncHandler; this catches anything that still escapes (e.g. a rejection in a
// background task) so one stray error can't crash the whole process.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: reason instanceof Error ? reason.stack : String(reason) });
});

const app = express();

app.use(helmet({
  // API-only server — no HTML is served, so CSP and frame options aren't needed.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());
app.use(requestLogger);

// Liveness/readiness probe — verifies the database answers. Used by the Docker
// healthcheck and any external monitor. Unauthenticated and cheap by design.
app.get('/health', (_req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
  skip: () => NODE_ENV === 'test' || NODE_ENV === 'development',
});

initDb();
reconcileOrphanedExecutions();
// wrapAsyncErrors forwards async route rejections to the error handler below
// (Express 4 does not do this on its own).
app.use('/auth', authLimiter, wrapAsyncErrors(authRoutes));
app.use('/connections', wrapAsyncErrors(connectionsRoutes));
app.use('/agent-providers', wrapAsyncErrors(agentProvidersRoutes));
app.use('/projects', wrapAsyncErrors(projectsRoutes));
app.use('/settings', wrapAsyncErrors(settingsRoutes));
app.use('/sessions', wrapAsyncErrors(sessionsRoutes));
app.use('/sessions', wrapAsyncErrors(messagesRoutes));
app.use('/executions', wrapAsyncErrors(executionsRoutes));
app.use('/memory', wrapAsyncErrors(memoryRoutes));
app.use('/webhooks', wrapAsyncErrors(webhooksRoutes));
app.use('/auth/google', wrapAsyncErrors(googleRoutes));

app.use('/documents', wrapAsyncErrors(documentsRoutes));
app.use('/media', wrapAsyncErrors(mediaRoutes));
app.use('/triggers', wrapAsyncErrors(triggersRoutes));

app.use('/mcp', mcpRouter);

// Must be registered after all routes.
app.use(notFoundHandler);
app.use(errorHandler);

const server = createServer(app);
initSocket(server);

// Stop accepting connections, finish in-flight requests, then close the DB so a
// deploy/restart doesn't drop work or leave the SQLite WAL mid-write.
function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down`);
  server.close(() => {
    closeDb();
    logger.info('Closed server and database');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10_000).unref();
}

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    logger.info(`Server running on port ${PORT}`);
  });
  startScheduler();
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app, server };
