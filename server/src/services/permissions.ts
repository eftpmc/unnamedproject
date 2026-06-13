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
  tool: DelegateTool,
  apiKey: string | null,
  profile: PermissionProfile,
): NodeJS.ProcessEnv {
  if (profile === 'trusted') {
    return tool === 'claude_code' && apiKey
      ? { ...process.env, ANTHROPIC_API_KEY: apiKey }
      : tool === 'codex' && apiKey
        ? { ...process.env, OPENAI_API_KEY: apiKey }
        : process.env;
  }

  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SHELL']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (process.env.NODE_ENV) env.NODE_ENV = process.env.NODE_ENV;
  if (tool === 'claude_code' && apiKey) env.ANTHROPIC_API_KEY = apiKey;
  if (tool === 'codex' && apiKey) env.OPENAI_API_KEY = apiKey;
  return env;
}

export function claudePermissionArgs(profile: PermissionProfile): string[] {
  return profile === 'strict' ? [] : ['--permission-mode', 'bypassPermissions'];
}

export function codexPermissionArgs(profile: PermissionProfile): string[] {
  return profile === 'strict' ? [] : ['--dangerously-bypass-approvals-and-sandbox'];
}
