import { Router } from 'express';
import bcrypt from 'bcrypt';
import { getDb, createScheduledTask } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { signToken } from '../lib/jwt.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error-handler.js';

const router = Router();

router.post('/register', asyncHandler(async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;

  if (userCount > 0 && process.env.ALLOW_REGISTRATION !== 'true') {
    res.status(403).json({ error: 'Registration closed' });
    return;
  }

  const hashed = await bcrypt.hash(password, 12);
  const id = newId();

  try {
    db.prepare('INSERT INTO users (id, email, hashed_password) VALUES (?, ?, ?)').run(id, email, hashed);
  } catch {
    res.status(409).json({ error: 'Email already registered' });
    return;
  }

  createScheduledTask(id, 'reorganize_memory', 24);

  res.status(201).json({ token: signToken(id) });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id, hashed_password FROM users WHERE email = ?').get(email) as
    | { id: string; hashed_password: string }
    | undefined;

  if (!user || !(await bcrypt.compare(password, user.hashed_password))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json({ token: signToken(user.id) });
}));

router.get('/me', requireAuth, (req, res) => {
  const { userId } = req as AuthedRequest;
  const user = getDb()
    .prepare('SELECT email FROM users WHERE id = ?')
    .get(userId) as { email: string } | undefined;
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ email: user.email });
});

export default router;
