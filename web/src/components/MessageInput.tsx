import { useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ClaudeModelInfo, EffortLevel } from '../types.js';

const EFFORT_OPTIONS: EffortLevel[] = ['low', 'medium', 'high'];

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  effort: EffortLevel;
  onEffortChange: (effort: EffortLevel) => void;
  model: string | null;
  onModelChange: (model: string | null) => void;
  models: ClaudeModelInfo[];
}

export default function MessageInput({ onSend, disabled, effort, onEffortChange, model, onModelChange, models }: MessageInputProps) {
  const [value, setValue] = useState('');

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div className="shrink-0 px-6 pb-5 pt-3">
      <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-3xl border border-border/65 bg-background/82 p-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/75">
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message…"
          disabled={disabled}
          rows={1}
          className={cn(
            'min-h-12 flex-1 resize-none border-0 bg-transparent px-3 py-3 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent',
            disabled && 'text-muted-foreground',
          )}
        />
        <div className="mb-1 flex shrink-0 items-center gap-2">
          <Select
            value={effort}
            onValueChange={value => onEffortChange(value as EffortLevel)}
          >
            <SelectTrigger
              size="sm"
              className="h-10 w-28 rounded-2xl border-border/60 bg-muted/60 text-xs dark:border-white/10 dark:bg-background/50 dark:hover:bg-background/60"
              aria-label="Effort"
            >
              <SelectValue placeholder="Effort" />
            </SelectTrigger>
            <SelectContent>
              {EFFORT_OPTIONS.map(option => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={model ?? 'auto'}
            onValueChange={value => onModelChange(value === 'auto' ? null : value)}
          >
            <SelectTrigger
              size="sm"
              className="h-10 w-36 rounded-2xl border-border/60 bg-muted/60 text-xs dark:border-white/10 dark:bg-background/50 dark:hover:bg-background/60"
              aria-label="Model"
            >
              <SelectValue placeholder="Model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {models.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="icon-lg"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
            className={cn(
              'rounded-2xl bg-foreground text-background hover:bg-foreground/90',
              disabled || !value.trim() ? 'bg-muted text-muted-foreground hover:bg-muted' : '',
            )}
          >
            <ArrowUp size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
