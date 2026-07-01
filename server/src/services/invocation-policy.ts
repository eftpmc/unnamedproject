export type InvocationMode = 'new_provider_session' | 'resume_provider_session' | 'fresh_with_summary';

interface SelectInvocationModeParams {
  providerSessionId?: string | null;
  prompt: string;
  messageCount: number;
  sessionCostUsd?: number;
  blockers?: string[];
  costFreshThresholdUsd?: number;
}

// Cost and message count at which hidden provider context becomes expensive
// enough that we prefer starting fresh with the structured summary.
const COST_FRESH_THRESHOLD_USD = 5.00;
const MESSAGE_FRESH_THRESHOLD = 30;

// These patterns mean the user explicitly wants a fresh orientation turn —
// asking what happened, summarizing, or explicitly stopping.
const FRESH_PATTERNS = [
  /\bwhat (are )?next steps\b/i,
  /\bdid you accomplish\b/i,
  /\bwhat (happened|did you do)\b/i,
  /\bstatus update\b/i,
  /\bsummari[sz]e\b/i,
  /\brecap\b/i,
  /\bstart (over|fresh|new)\b/i,
  /\bforget (the context|what you know|everything)\b/i,
  /\bbe done\b/i,
  /\bstop there\b/i,
];

// These patterns mean the user explicitly wants to continue the live session —
// literally picking up where things left off, or retrying the exact previous action.
// Kept narrow to avoid matching incidental words like "click" in coding tasks.
const RESUME_PATTERNS = [
  /^\s*(try again|continue|keep going|go|now go)\s*$/i,
  /\bresume\b/i,
  /\bpick up\b/i,
  /\bwhere you left off\b/i,
  /\bsame (browser|page|tab|session)\b/i,
  /\btry (clicking|navigating|pressing|submitting) (again|it|that)\b/i,
];

function isShortFollowUp(prompt: string): boolean {
  return prompt.trim().split(/\s+/).length <= 5;
}

// If the session state has recorded that the same browser action failed
// repeatedly, the agent needs to see that blocker in its fresh system context
// rather than buried in hidden provider history it might ignore.
function hasLoopBlocker(blockers: string[]): boolean {
  return blockers.some(b => /repeatedly|do not retry/i.test(b));
}

export function selectInvocationMode(params: SelectInvocationModeParams): InvocationMode {
  if (!params.providerSessionId) return 'new_provider_session';

  const prompt = params.prompt.trim();

  // Explicit fresh request always wins.
  if (FRESH_PATTERNS.some(p => p.test(prompt))) return 'fresh_with_summary';

  // Loop blocker detected: the agent already tried and failed the same action
  // repeatedly. Start fresh so the blocker appears in the system context.
  if (params.blockers && hasLoopBlocker(params.blockers)) return 'fresh_with_summary';

  // Cost threshold always wins — session is too expensive to keep resuming.
  const costThreshold = params.costFreshThresholdUsd ?? COST_FRESH_THRESHOLD_USD;
  if ((params.sessionCostUsd ?? 0) >= costThreshold) return 'fresh_with_summary';

  // Explicit resume patterns override the message-count threshold. If the user
  // says "try again" or "try clicking that again" they need live session state
  // (e.g. browser automation context). Cost is still the hard stop above.
  if (RESUME_PATTERNS.some(p => p.test(prompt))) return 'resume_provider_session';

  // Long chats carry expensive hidden context — start fresh from the summary.
  if (params.messageCount >= MESSAGE_FRESH_THRESHOLD) return 'fresh_with_summary';

  // Short follow-ups (acknowledgements, quick tweaks) are cheap to continue.
  if (isShortFollowUp(prompt)) return 'resume_provider_session';

  return 'resume_provider_session';
}

export function modeUsesProviderResume(mode: InvocationMode): boolean {
  return mode === 'resume_provider_session';
}
