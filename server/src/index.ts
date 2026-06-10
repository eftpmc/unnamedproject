import express from 'express';
import { createServer } from 'http';

const PORT = process.env.PORT ?? '3000';
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV;

if (!JWT_SECRET && NODE_ENV !== 'test') {
  console.warn('WARNING: JWT_SECRET is not set. Set it in production.');
}

const app = express();
app.use(express.json());

const server = createServer(app);

if (NODE_ENV !== 'test') {
  server.listen(parseInt(PORT), () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export { app, server };
