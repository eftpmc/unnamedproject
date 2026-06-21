import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ClaudeModelInfo, EffortLevel } from '../types.js';

export default function ChatConfigPopover({
  effort,
  model,
  models,
  onConfigChange,
}: {
  effort: EffortLevel;
  model: string | null;
  models: ClaudeModelInfo[];
  onConfigChange: (config: { effort?: EffortLevel; model?: string | null }) => void;
}) {
  const currentModel = models.find(m => m.id === model);
  const label = `${effort} · ${currentModel?.display_name ?? 'Auto'}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex h-7 max-w-28 gap-1.5 rounded-lg border border-border/50 bg-muted/70 px-3 text-xs font-normal sm:max-w-none"
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-3">
        <div className="flex flex-col gap-3">
          <div>
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
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Model</div>
            <Select
              value={model ?? 'auto'}
              onValueChange={value => onConfigChange({ model: value === 'auto' ? null : value })}
            >
              <SelectTrigger size="sm" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                {models.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
