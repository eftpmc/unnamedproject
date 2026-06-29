export type InvocationMode = 'new_provider_session' | 'resume_provider_session' | 'fresh_with_summary';

interface SelectInvocationModeParams {
  providerSessionId?: string | null;
  prompt: string;
  messageCount: number;
}

const FRESH_PATTERNS = [
  /\bwhat (are )?next steps\b/i,
  /\bdid you accomplish\b/i,
  /\bwhat happened\b/i,
  /\bstatus\b/i,
  /\bsummari[sz]e\b/i,
  /\brecap\b/i,
  /\bupdate\b.*\b(index|document|docs|frontmatter)\b/i,
  /\bwrite\b.*\b(index|document|docs|frontmatter)\b/i,
  /\bbe done\b/i,
  /\bstop there\b/i,
];

const RESUME_PATTERNS = [
  /^\s*(try again|continue|keep going|go|now go)\s*$/i,
  /\bresume\b/i,
  /\bpick up\b/i,
  /\bwhere you left off\b/i,
  /\bsame (browser|page|tab|session)\b/i,
  /\b(click|login|browser|tab|page)\b/i,
];

export function selectInvocationMode(params: SelectInvocationModeParams): InvocationMode {
  if (!params.providerSessionId) return 'new_provider_session';

  const prompt = params.prompt.trim();
  if (FRESH_PATTERNS.some(pattern => pattern.test(prompt))) return 'fresh_with_summary';
  if (RESUME_PATTERNS.some(pattern => pattern.test(prompt))) return 'resume_provider_session';

  // Long chats are where provider-side hidden context gets expensive. Prefer the
  // app-owned summary unless the user clearly asks to continue live tool state.
  if (params.messageCount >= 12) return 'fresh_with_summary';

  return 'resume_provider_session';
}

export function modeUsesProviderResume(mode: InvocationMode): boolean {
  return mode === 'resume_provider_session';
}
