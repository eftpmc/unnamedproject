export type Domain = 'code' | 'writing' | 'research' | 'creative' | 'image' | 'multi' | 'general';

// Kept as an object so callers can destructure or extend without a signature change
export interface Intent {
  domain: Domain;
}

const CODE_RE = /\b(debug|fix|implement|build|refactor|test|deploy|git|pull.?request|branch|api|function|class|component|module|repo|codebase|script|server|database|sql|typescript|javascript|python|rust|go|java|css|html|endpoint|bug|error|crash|feature|install|package|cli|ci|cd|lint|type.?check)\b/i;
const RESEARCH_RE = /\b(what is|what are|how does|how do|explain|compare|find|research|look up|who is|when did|why does|summarize|overview|difference between)\b/i;
const WRITING_RE = /\b(write|draft|email|document|spec|essay|blog|article|proposal|readme|changelog|release.?notes|cover.?letter|announcement)\b/i;
const CREATIVE_RE = /\b(story|poem|creative|brainstorm|idea|fiction|imagine|design|concept|name|slogan|tagline)\b/i;
const IMAGE_RE = /\b(generate.{0,10}image|draw|illustrate|render.{0,10}image|dalle|midjourney)\b/i;

export const DEFAULT_INTENT: Intent = { domain: 'general' };

export function classifyIntent(userMessage: string): Intent {
  const isCode = CODE_RE.test(userMessage);
  const isResearch = RESEARCH_RE.test(userMessage);
  const isWriting = WRITING_RE.test(userMessage);
  const isCreative = CREATIVE_RE.test(userMessage);
  const isImage = IMAGE_RE.test(userMessage);

  const signalCount = [isCode, isResearch, isWriting, isCreative].filter(Boolean).length;

  const domain: Domain = isImage ? 'image'
    : signalCount > 1 ? 'multi'
    : isCode ? 'code'
    : isResearch ? 'research'
    : isWriting ? 'writing'
    : isCreative ? 'creative'
    : 'general';

  return { domain };
}
