import fs from 'fs';
import path from 'path';
import { beforeAll, afterAll } from 'vitest';
import { closeDb } from '../src/db/index.js';

process.env.JWT_SECRET = 'test-secret-32-chars-long-enough!!';
process.env.DATA_DIR = '/tmp/unnamedproject-test';
process.env.NODE_ENV = 'test';
process.env.ALLOW_REGISTRATION = 'true';

beforeAll(() => {
  // Delete stale DB so each test file starts from a clean schema.
  // Prevents partial migrations (e.g. campaign_tasks_old2) from a previous
  // run from breaking FK cascades in unrelated tests.
  closeDb();
  const dbPath = path.join(process.env.DATA_DIR!, 'app.db');
  try { fs.unlinkSync(dbPath); } catch { /* not present, that's fine */ }
});

afterAll(() => {
  closeDb();
});
