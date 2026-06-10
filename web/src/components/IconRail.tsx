import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, MessagesSquare, LayoutGrid, Settings, Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/useTheme.js';

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
      className={`btn btn-square btn-ghost shrink-0 ${active ? 'bg-base-300 text-base-content' : 'text-base-content/40 hover:text-base-content/70'}`}
    >
      {children}
    </button>
  );
}

export default function IconRail({ activePanel, onPanelToggle }: IconRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSettings = location.pathname === '/settings';
  const { theme, toggleTheme } = useTheme();

  function handleNewSession() {
    navigate('/s');
  }

  return (
    <div className="w-16 bg-base-200 border-r border-base-300 flex flex-col items-center py-4 gap-2 shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 bg-base-content rounded-xl mb-2 shrink-0" />

      {/* New session */}
      <IconBtn title="New session" onClick={handleNewSession}>
        <Plus size={20} strokeWidth={1.75} />
      </IconBtn>

      {/* Sessions */}
      <IconBtn
        title="Sessions"
        active={activePanel === 'sessions' && !isSettings}
        onClick={() => onPanelToggle('sessions')}
      >
        <MessagesSquare size={20} strokeWidth={1.75} />
      </IconBtn>

      {/* Workspaces */}
      <IconBtn
        title="Workspaces"
        active={activePanel === 'workspaces' && !isSettings}
        onClick={() => onPanelToggle('workspaces')}
      >
        <LayoutGrid size={20} strokeWidth={1.75} />
      </IconBtn>

      <div className="flex-1" />

      {/* Theme toggle */}
      <IconBtn title="Toggle theme" onClick={toggleTheme}>
        {theme === 'unnamed-dark' ? <Moon size={20} strokeWidth={1.75} /> : <Sun size={20} strokeWidth={1.75} />}
      </IconBtn>

      {/* Settings */}
      <IconBtn
        title="Settings"
        active={isSettings}
        onClick={() => navigate('/settings')}
      >
        <Settings size={20} strokeWidth={1.75} />
      </IconBtn>
    </div>
  );
}
