interface EmptyStateProps {
  onNewSession: () => void;
}

export default function EmptyState({ onNewSession }: EmptyStateProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
    }}>
      <div style={{ color: '#444444', fontSize: 12 }}>Start a session</div>
      <div style={{ color: '#333333', fontSize: 10 }}>Talk to the agent to plan, execute, and manage work across your projects.</div>
      <button
        onClick={onNewSession}
        style={{
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: '7px 16px',
          color: '#cccccc',
          fontSize: 11,
          cursor: 'pointer',
          marginTop: 4,
        }}
      >
        New session
      </button>
    </div>
  );
}
