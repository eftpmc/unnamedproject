interface EmptyStateProps {
  onNewSession: () => void;
}

export default function EmptyState({ onNewSession }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="text-base-content/70 text-lg font-medium">Start a session</div>
      <div className="text-base-content/40 text-sm max-w-xs">Talk to the agent to plan, execute, and manage work across your projects.</div>
      <button
        onClick={onNewSession}
        className="btn rounded-full bg-base-content text-base-100 border-none hover:opacity-90 mt-2"
      >
        New session
      </button>
    </div>
  );
}
