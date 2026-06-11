import { useState, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface MessageInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function MessageInput({ onSend, disabled }: MessageInputProps) {
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
        <div className="mb-1">
          <Button
            size="icon-lg"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="Send"
            className={cn(
              'rounded-2xl bg-foreground text-background hover:bg-foreground/90',
              (disabled || !value.trim()) && 'bg-muted text-muted-foreground hover:bg-muted',
            )}
          >
            <ArrowUp size={16} strokeWidth={2} />
          </Button>
        </div>
      </div>
    </div>
  );
}
