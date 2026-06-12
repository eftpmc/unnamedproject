import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [value]);

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
    <div className="shrink-0 px-4 pb-4 pt-3 sm:px-6 sm:pb-5">
      <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-xl border border-border/65 bg-background/82 p-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-card/75 sm:gap-3">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Agent is responding…' : 'Message…'}
          disabled={disabled}
          rows={1}
          className={cn(
            'max-h-44 min-h-12 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-3 py-3 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent',
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
              'rounded-xl bg-foreground text-background hover:bg-foreground/90',
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
