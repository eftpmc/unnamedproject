import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, MessagesSquare, LayoutGrid, Settings, Sun, Moon } from 'lucide-react';
import { useTheme } from '../lib/useTheme.js';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface IconRailProps {
  activePanel: 'sessions' | 'projects' | null;
  onPanelToggle: (panel: 'sessions' | 'projects') => void;
}

function IconBtn({ active, onClick, title, children }: {
  active?: boolean;
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={title}
          onClick={onClick}
          className={cn(
            'rounded-2xl',
            active ? 'bg-background shadow-xs ring-1 ring-border/50' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{title}</TooltipContent>
    </Tooltip>
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
    <aside className="flex w-14 shrink-0 flex-col items-center gap-2 rounded-3xl bg-background/50 py-3 backdrop-blur">
      <div className="mb-2 grid size-9 shrink-0 place-items-center rounded-2xl bg-foreground text-background shadow-sm">
        <span className="text-sm font-semibold">u</span>
      </div>

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

      {/* Projects */}
      <IconBtn
        title="Projects"
        active={activePanel === 'projects' && !isSettings}
        onClick={() => onPanelToggle('projects')}
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
    </aside>
  );
}
