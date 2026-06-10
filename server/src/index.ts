import express from 'express';
import { createServer } from 'http';
import { initDb } from './db/index.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import workspacesRoutes from './routes/workspaces.js';

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

const server = createServer(app);

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app, server };
