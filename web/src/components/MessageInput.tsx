import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface MessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export default function MessageInput({ value, onChange, onSend, disabled }: MessageInputProps) {
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
    if (!value.trim() || disabled) return;
    onSend();
  }

  return (
    <div className="shrink-0 px-5 pb-5 pt-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border-soft bg-card px-3 pb-2.5 pt-2.5 shadow-sm">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? 'Agent is responding…' : 'Message…'}
          disabled={disabled}
          rows={1}
          className="max-h-44 min-h-[1.5rem] flex-1 resize-none border-0 bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          title="Send"
          className={cn(
            'mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-[filter]',
            value.trim() && !disabled
              ? 'bg-primary text-primary-foreground hover:brightness-105'
              : 'bg-muted text-faint-fg cursor-default',
          )}
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
