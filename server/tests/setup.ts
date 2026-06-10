import { afterAll } from 'vitest';
import { closeDb } from '../src/db/index.js';

process.env.JWT_SECRET = 'test-secret-32-chars-long-enough!!';
process.env.DATA_DIR = '/tmp/unnamedproject-test';
process.env.NODE_ENV = 'test';
process.env.ALLOW_REGISTRATION = 'true';

afterAll(() => {
  closeDb();
});
