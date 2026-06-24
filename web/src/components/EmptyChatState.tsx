import { type KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface EmptyChatStateProps {
  value: string;
  onChange: (value: string) => void;
  onSendContent: (content: string) => void;
  disabled: boolean;
  projectName?: string;
}

const DEFAULT_PROMPTS = [
  'Help me plan the next useful step.',
  'Review this app and suggest the highest-impact improvements.',
  'Start by asking me the fewest questions needed to get moving.',
];

export default function EmptyChatState({ value, onChange, onSendContent, disabled, projectName }: EmptyChatStateProps) {
  const prompts = projectName
    ? [
        `Give me a quick orientation to ${projectName}.`,
        `Review the current state of ${projectName} and suggest next steps.`,
        `Find the highest-impact UI/UX improvements for ${projectName}.`,
      ]
    : DEFAULT_PROMPTS;

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSendContent(trimmed);
  }

  return (
    <div className="flex flex-1 items-end justify-center pb-5 sm:items-center sm:pb-0">
      <div className="w-full px-4 sm:px-6" style={{ maxWidth: '46rem' }}>
        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {prompts.map(prompt => (
            <button
              key={prompt}
              type="button"
              disabled={disabled}
              onClick={() => submit(prompt)}
              className="rounded-xl border border-border-soft bg-card px-3 py-2.5 text-left text-xs text-muted-foreground transition-[border-color,box-shadow] hover:border-border hover:text-foreground hover:shadow-sm disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="rounded-[18px] border border-input bg-card px-3 pb-2.5 pt-2.5 shadow-sm">
          <Textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            placeholder="Message…"
            disabled={disabled}
            rows={1}
            autoFocus
            className="max-h-44 min-h-[1.5rem] w-full resize-none border-0 bg-transparent dark:bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => submit(value)}
              disabled={!value.trim() || disabled}
              title="Send"
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-[filter,transform] active:translate-y-px',
                value.trim() && !disabled
                  ? 'bg-primary text-primary-foreground hover:brightness-105'
                  : 'bg-muted text-faint-fg cursor-default',
              )}
            >
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
