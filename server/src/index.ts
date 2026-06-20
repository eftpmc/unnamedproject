import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createServer } from 'http';
import { initDb, reconcileOrphanedExecutions } from './db/index.js';
import { initSocket } from './services/socket.js';
import { startScheduler } from './services/scheduler.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import projectsRoutes from './routes/projects.js';
import settingsRoutes from './routes/settings.js';
import sessionsRoutes from './routes/sessions.js';
import messagesRoutes from './routes/messages.js';
import executionsRoutes from './routes/executions.js';
import memoryRoutes from './routes/memory.js';
import scheduledTasksRoutes from './routes/scheduled_tasks.js';
import plansRoutes from './routes/plans.js';
import pipelinesRoutes from './routes/pipelines.js';

const PORT = process.env.PORT ?? '3000';
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV;

if (!JWT_SECRET && NODE_ENV !== 'test') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in production.');
}

// An async route handler that throws outside its own try/catch (e.g. a bad
// decrypt) becomes an unhandled rejection, which crashes the whole process by
// default since Node 15. Log instead so one bad request can't take down every
// user's session.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const app = express();

app.use(helmet({
  // API-only server — no HTML is served, so CSP and frame options aren't needed.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
  skip: () => NODE_ENV === 'test',
});

initDb();
reconcileOrphanedExecutions();
app.use('/auth', authLimiter, authRoutes);
app.use('/connections', connectionsRoutes);
app.use('/projects', projectsRoutes);
app.use('/settings', settingsRoutes);
app.use('/sessions', sessionsRoutes);
app.use('/sessions', messagesRoutes);
app.use('/executions', executionsRoutes);
app.use('/memory', memoryRoutes);
app.use('/scheduled-tasks', scheduledTasksRoutes);
app.use('/plans', plansRoutes);
app.use('/pipelines', pipelinesRoutes);

const server = createServer(app);
initSocket(server);

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
  startScheduler();
}

export { app, server };
