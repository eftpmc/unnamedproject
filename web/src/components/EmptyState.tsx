import { useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound } from 'lucide-react';
import { CenteredEmptyState } from '@/components/ui/app-layout';

interface EmptyStateProps {
  onNewChat: () => void;
  hasLeadAgent: boolean;
}

export default function EmptyState({ onNewChat, hasLeadAgent }: EmptyStateProps) {
  const navigate = useNavigate();

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
              Connect an Anthropic API key to power the lead agent.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex w-full items-center justify-between rounded-xl border border-border-soft bg-card px-4 py-3.5 text-left transition-[border-color,box-shadow] hover:border-border hover:shadow-sm"
          >
            <div>
              <div className="text-sm font-medium text-foreground">Open Settings → Agents</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Add your Anthropic API key to get started</div>
            </div>
            <ArrowRight size={15} className="shrink-0 text-faint-fg" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <CenteredEmptyState
      title="Start a chat"
      description="Talk to the agent to plan, execute, and manage work across your projects."
      actionLabel="New chat"
      onAction={onNewChat}
    />
  );
}
