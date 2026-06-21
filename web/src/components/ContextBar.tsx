import { cn } from '../lib/utils.js';

const CONTEXT_WINDOW = 200_000;

export default function ContextBar({ inputTokens }: { inputTokens: number }) {
  const pct = Math.min(inputTokens / CONTEXT_WINDOW, 1);
  const used = pct * 100;
  const color = pct > 0.85 ? 'bg-destructive' : pct > 0.6 ? 'bg-warning' : 'bg-primary/50';
  const label = `${Math.round(used)}% of context used · ${inputTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()} tokens`;

  return (
    <div title={label} className="flex items-center gap-2 group/ctx cursor-default">
      <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${used}%` }} />
      </div>
      <span className="text-[10px] text-faint-fg opacity-0 transition-opacity group-hover/ctx:opacity-100">
        {Math.round(used)}% context
      </span>
    </div>
  );
}
