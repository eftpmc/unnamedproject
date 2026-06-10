import express from 'express';
import { createServer } from 'http';
import { initDb } from './db/index.js';
import { initSocket } from './services/socket.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import workspacesRoutes from './routes/workspaces.js';
import threadsRoutes from './routes/threads.js';
import messagesRoutes from './routes/messages.js';
import executionsRoutes from './routes/executions.js';

const PORT = process.env.PORT ?? '3000';
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV;

if (!JWT_SECRET && NODE_ENV !== 'test') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in production.');
}

const app = express();
app.use(express.json());

initDb();
app.use('/auth', authRoutes);
app.use('/connections', connectionsRoutes);
app.use('/workspaces', workspacesRoutes);
app.use('/threads', threadsRoutes);
app.use('/threads', messagesRoutes);
app.use('/executions', executionsRoutes);

const server = createServer(app);
initSocket(server);

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app, server };
