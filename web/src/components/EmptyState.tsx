import { CenteredEmptyState } from '@/components/ui/app-layout';

interface EmptyStateProps {
  onNewChat: () => void;
}

export default function EmptyState({ onNewChat }: EmptyStateProps) {
  return (
    <CenteredEmptyState
      title="Start a chat"
      description="Talk to the agent to plan, execute, and manage work across your projects."
      actionLabel="New chat"
      onAction={onNewChat}
    />
  );
}
