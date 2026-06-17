export interface Intent {
  domain: 'code' | 'writing' | 'research' | 'creative' | 'image' | 'multi' | 'general';
  complexity: 'low' | 'medium' | 'high';
  model: 'haiku' | 'sonnet' | 'fable' | 'opus';
  tools: string[];
  scope: 'inline' | 'delegate' | 'plan';
  needs_research: boolean;
  ambiguous: boolean;
}

export const DEFAULT_INTENT: Intent = {
  domain: 'general',
  complexity: 'medium',
  model: 'sonnet',
  tools: [],
  scope: 'inline',
  needs_research: false,
  ambiguous: true,
};

const CODE_RE = /\b(debug|fix|implement|build|refactor|test|deploy|git|pull.?request|branch|api|function|class|component|module|repo|codebase|script|server|database|sql|typescript|javascript|python|rust|go|java|css|html|endpoint|bug|error|crash|feature|install|package|cli|ci|cd|lint|type.?check)\b/i;
const RESEARCH_RE = /\b(what is|what are|how does|how do|explain|compare|find|research|look up|who is|when did|why does|summarize|overview|difference between)\b/i;
const WRITING_RE = /\b(write|draft|email|document|spec|essay|blog|article|proposal|readme|changelog|release.?notes|cover.?letter|announcement)\b/i;
const CREATIVE_RE = /\b(story|poem|creative|brainstorm|idea|fiction|imagine|design|concept|name|slogan|tagline)\b/i;
const IMAGE_RE = /\b(generate.{0,10}image|draw|illustrate|render.{0,10}image|dalle|midjourney)\b/i;
const HIGH_COMPLEXITY_RE = /\b(architecture|migrate|redesign|overhaul|comprehensive|entire|refactor.{0,20}(all|whole|entire)|multiple.{0,20}(file|system|service)|plan|parallel|series|sequence)\b/i;
const CAMPAIGN_RE = /\b(plan|multiple.{0,20}(task|step)|parallel.{0,20}(task|step)|series.{0,20}(of|task|step)|batch|pipeline)\b/i;

export function classifyIntent(userMessage: string): Intent {
  const msg = userMessage;
  const words = msg.trim().split(/\s+/).length;

  const isCode = CODE_RE.test(msg);
  const isResearch = RESEARCH_RE.test(msg);
  const isWriting = WRITING_RE.test(msg);
  const isCreative = CREATIVE_RE.test(msg);
  const isImage = IMAGE_RE.test(msg);

  const signalCount = [isCode, isResearch, isWriting, isCreative].filter(Boolean).length;

  const domain: Intent['domain'] = isImage ? 'image'
    : signalCount > 1 ? 'multi'
    : isCode ? 'code'
    : isResearch ? 'research'
    : isWriting ? 'writing'
    : isCreative ? 'creative'
    : 'general';

  const isHighComplexity = HIGH_COMPLEXITY_RE.test(msg) || words > 80;
  const isLowComplexity = words < 15 && !isCode && !CAMPAIGN_RE.test(msg);

  const complexity: Intent['complexity'] = isHighComplexity ? 'high' : isLowComplexity ? 'low' : 'medium';
  const model: Intent['model'] = isHighComplexity ? 'opus' : isLowComplexity ? 'haiku' : 'sonnet';

  const scope: Intent['scope'] = CAMPAIGN_RE.test(msg) ? 'plan'
    : (isCode && !isLowComplexity) ? 'delegate'
    : 'inline';

  return {
    domain,
    complexity,
    model,
    tools: [],
    scope,
    needs_research: isResearch,
    ambiguous: signalCount === 0 && !isImage,
  };
}
