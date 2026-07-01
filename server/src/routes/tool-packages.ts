import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  disableToolPackage,
  installToolPackage,
  listToolPackages,
  testToolPackage,
} from '../services/tool-packages.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json(listToolPackages(userId));
});

router.post('/:id/test', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  const result = await testToolPackage(userId, req.params.id);
  res.json(result);
});

router.post('/:id/install', async (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  try {
    res.json(await installToolPackage(userId, req.params.id));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/:id/disable', (req, res) => {
  const { userId } = req as unknown as AuthedRequest;
  try {
    res.json(disableToolPackage(userId, req.params.id));
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
