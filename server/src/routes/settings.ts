import { Router } from 'express';
import { getProjectsRoot, setProjectsRoot, getPermissionProfile, setPermissionProfile, getExpoPushToken, setExpoPushToken, getApnsDeviceToken, setApnsDeviceToken } from '../db/index.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isPermissionProfile } from '../services/permissions.js';
import { assertOutsideAppRoot, resolveWorkspacePath } from '../lib/workspacePaths.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  res.json({
    projects_root: getProjectsRoot(userId),
    permission_profile: getPermissionProfile(userId),
  });
});

router.put('/', (req, res) => {
  const { userId } = req as AuthedRequest;
  const { projects_root, permission_profile, expoPushToken, apnsDeviceToken } = req.body as {
    projects_root?: string;
    permission_profile?: unknown;
    expoPushToken?: string | null;
    apnsDeviceToken?: string | null;
  };
  if (permission_profile !== undefined && !isPermissionProfile(permission_profile)) {
    res.status(400).json({ error: 'permission_profile must be one of chat_only, project_files, project_tools, external_actions, tool_builder, isolated, self_modify' });
    return;
  }
  if (expoPushToken !== undefined && expoPushToken !== null) {
    if (typeof expoPushToken !== 'string' || expoPushToken.length > 512 || !expoPushToken.startsWith('ExponentPushToken[')) {
      res.status(400).json({ error: 'expoPushToken must be a valid Expo push token' });
      return;
    }
  }
  if (apnsDeviceToken !== undefined && apnsDeviceToken !== null) {
    if (typeof apnsDeviceToken !== 'string' || !/^[0-9a-f]{64}$/i.test(apnsDeviceToken)) {
      res.status(400).json({ error: 'apnsDeviceToken must be a 64-character hex string' });
      return;
    }
  }
  if (projects_root !== undefined) {
    const normalizedProjectsRoot = projects_root.trim() ? resolveWorkspacePath(projects_root) : '';
    if (normalizedProjectsRoot) {
      try {
        assertOutsideAppRoot(normalizedProjectsRoot, 'projects_root');
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'projects_root must be outside the app repository' });
        return;
      }
    }
    setProjectsRoot(userId, normalizedProjectsRoot);
  }
  if (permission_profile !== undefined) setPermissionProfile(userId, permission_profile);
  if (expoPushToken !== undefined) setExpoPushToken(userId, expoPushToken ?? null);
  if (apnsDeviceToken !== undefined) setApnsDeviceToken(userId, apnsDeviceToken ?? null);
  res.json({
    projects_root: getProjectsRoot(userId),
    permission_profile: getPermissionProfile(userId),
  });
});

export default router;
