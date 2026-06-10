interface EmptyStateProps {
  onNewSession: () => void;
}

export default function EmptyState({ onNewSession }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3">
      <div className="text-[#444444] text-xs">Start a session</div>
      <div className="text-[#333333] text-[10px]">Talk to the agent to plan, execute, and manage work across your projects.</div>
      <button
        onClick={onNewSession}
        className="btn btn-sm bg-neutral border-neutral-content/20 text-base-content text-[11px] mt-1"
      >
        New session
      </button>
    </div>
  );
}
