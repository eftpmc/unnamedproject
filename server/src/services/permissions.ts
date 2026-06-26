export const PERMISSION_PROFILES = ['fast', 'trusted', 'strict'] as const;

export type PermissionProfile = typeof PERMISSION_PROFILES[number];
export type DelegateTool = 'claude_code' | 'codex';

export function isPermissionProfile(value: unknown): value is PermissionProfile {
  return typeof value === 'string' && PERMISSION_PROFILES.includes(value as PermissionProfile);
}

export function normalizePermissionProfile(value: unknown): PermissionProfile {
  return isPermissionProfile(value) ? value : 'fast';
}

export function getDelegateEnv(
  _tool: DelegateTool,
  profile: PermissionProfile,
): NodeJS.ProcessEnv {
  if (profile === 'trusted') return process.env;

  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'SHELL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
  return env;
}

export function claudePermissionArgs(profile: PermissionProfile): string[] {
  return profile === 'strict' ? [] : ['--permission-mode', 'bypassPermissions'];
}

export function codexPermissionArgs(profile: PermissionProfile): string[] {
  return profile === 'strict' ? [] : ['--dangerously-bypass-approvals-and-sandbox'];
}
