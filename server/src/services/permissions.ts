export const PERMISSION_PROFILES = ['fast', 'trusted', 'strict'] as const;

export type PermissionProfile = typeof PERMISSION_PROFILES[number];
export type DelegateTool = 'claude_code';

export function isPermissionProfile(value: unknown): value is PermissionProfile {
  return typeof value === 'string' && PERMISSION_PROFILES.includes(value as PermissionProfile);
}

export function normalizePermissionProfile(value: unknown): PermissionProfile {
  return isPermissionProfile(value) ? value : 'fast';
}

export function getDelegateEnv(
  _tool: DelegateTool,
  profile: PermissionProfile,
  runtime?: { homeDir?: string; tmpDir?: string; apiKey?: string },
): NodeJS.ProcessEnv {
  if (profile === 'trusted') return runtime?.apiKey ? { ...process.env, ANTHROPIC_API_KEY: runtime.apiKey } : process.env;

  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'USER', 'LOGNAME', 'SHELL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (profile === 'strict' && runtime?.homeDir) {
    env.HOME = runtime.homeDir;
    env.XDG_CONFIG_HOME = `${runtime.homeDir}/.config`;
    env.XDG_CACHE_HOME = `${runtime.homeDir}/.cache`;
    env.XDG_DATA_HOME = `${runtime.homeDir}/.local/share`;
    env.NPM_CONFIG_CACHE = `${runtime.homeDir}/.cache/npm`;
    env.PIP_CACHE_DIR = `${runtime.homeDir}/.cache/pip`;
  } else if (process.env.HOME) {
    env.HOME = process.env.HOME;
  }
  if (profile === 'strict' && runtime?.tmpDir) {
    env.TMPDIR = runtime.tmpDir;
    env.TEMP = runtime.tmpDir;
    env.TMP = runtime.tmpDir;
  } else {
    for (const key of ['TMPDIR', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  if (runtime?.apiKey) env.ANTHROPIC_API_KEY = runtime.apiKey;
  if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
  return env;
}

export function claudePermissionArgs(profile: PermissionProfile): string[] {
  return profile === 'strict' ? [] : ['--permission-mode', 'bypassPermissions'];
}
