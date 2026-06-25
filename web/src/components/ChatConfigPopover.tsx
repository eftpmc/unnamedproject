import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { EffortLevel } from '../types.js';

export default function ChatConfigPopover({
  effort,
  onConfigChange,
}: {
  effort: EffortLevel;
  onConfigChange: (config: { effort?: EffortLevel }) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-7 max-w-28 gap-1.5 rounded-lg border border-border/50 bg-muted/70 px-3 text-xs font-normal sm:max-w-none"
        >
          <span className="truncate">{effort}</span>
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40 p-3">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Effort</div>
        <div className="flex gap-1">
          {(['low', 'medium', 'high'] as EffortLevel[]).map(o => (
            <Button
              key={o}
              size="sm"
              variant={effort === o ? 'default' : 'ghost'}
              className="h-7 flex-1 text-xs"
              onClick={() => onConfigChange({ effort: o })}
            >
              {o}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
