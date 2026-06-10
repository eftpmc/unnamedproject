import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { recallAll } from '../services/memory.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json(recallAll(userId));
});

export default router;
