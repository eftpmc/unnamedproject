import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUp, KeyRound } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createChat, sendMessage } from '../lib/api.js';

interface EmptyStateProps {
  hasLeadAgent: boolean;
}

const STARTER_PROMPTS = [
  'Help me plan the next useful step.',
  'Review this app and suggest the highest-impact improvements.',
  'Start by asking me the fewest questions needed to get moving.',
];

export default function EmptyState({ hasLeadAgent }: EmptyStateProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  if (!hasLeadAgent) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <KeyRound size={22} strokeWidth={1.75} />
            </div>
            <h2 className="text-base font-semibold text-foreground">One step before you start</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Connect Claude Code or Codex to power your conversations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex w-full items-center justify-between rounded-xl border border-border-soft bg-card px-4 py-3.5 text-left transition-[border-color,box-shadow] hover:border-border hover:shadow-sm"
          >
            <div>
              <div className="text-sm font-medium text-foreground">Open Settings → Tools</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Add Claude Code or Codex to get started</div>
            </div>
            <ArrowRight size={15} className="shrink-0 text-faint-fg" />
          </button>
        </div>
      </div>
    );
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const { id } = await createChat();
      await sendMessage(id, trimmed);
      navigate(`/c/${id}`);
    } catch {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-1 items-end justify-center pb-5 sm:items-center sm:pb-0">
      <div className="w-full px-4 sm:px-6" style={{ maxWidth: '46rem' }}>
        <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {STARTER_PROMPTS.map(prompt => (
            <button
              key={prompt}
              type="button"
              disabled={sending}
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
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(value);
              }
            }}
            placeholder="What can I help with?"
            disabled={sending}
            rows={1}
            autoFocus
            className="max-h-44 min-h-[1.5rem] w-full resize-none border-0 bg-transparent dark:bg-transparent px-1 py-1 text-[15px] shadow-none placeholder:text-faint-fg focus-visible:ring-0"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => submit(value)}
              disabled={!value.trim() || sending}
              title="Send"
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-[filter,transform] active:translate-y-px',
                value.trim() && !sending
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
