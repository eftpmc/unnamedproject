import { useNavigate, useLocation } from 'react-router-dom';

interface IconRailProps {
  activePanel: 'sessions' | 'workspaces' | null;
  onPanelToggle: (panel: 'sessions' | 'workspaces') => void;
}

function IconBtn({ active, onClick, title, children }: {
  active?: boolean;
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`btn btn-square btn-sm btn-ghost shrink-0 ${active ? 'bg-neutral text-base-content' : 'text-[#555555]'}`}
    >
      {children}
    </button>
  );
}

export default function IconRail({ activePanel, onPanelToggle }: IconRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettings = location.pathname === '/settings';

  function handleNewSession() {
    navigate('/s');
  }

  return (
    <div className="w-11 bg-base-200 border-r border-neutral flex flex-col items-center py-2.5 gap-1 shrink-0">
      {/* Logo */}
      <div className="w-5.5 h-5.5 bg-neutral rounded mb-2 shrink-0" />

      {/* New session */}
      <IconBtn title="New session" onClick={handleNewSession}>
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
          <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </IconBtn>

      {/* Sessions */}
      <IconBtn
        title="Sessions"
        active={activePanel === 'sessions' && !isSettings}
        onClick={() => onPanelToggle('sessions')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M4 11l1.5-2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </IconBtn>

      {/* Workspaces */}
      <IconBtn
        title="Workspaces"
        active={activePanel === 'workspaces' && !isSettings}
        onClick={() => onPanelToggle('workspaces')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="8" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="2" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="8" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </IconBtn>

      <div className="flex-1" />

      {/* Settings */}
      <IconBtn
        title="Settings"
        active={isSettings}
        onClick={() => navigate('/settings')}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.2 3.2l.7.7M10.1 10.1l.7.7M10.1 3.2l-.7.7M3.2 10.1l-.7.7"
            stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </IconBtn>
    </div>
  );
}
