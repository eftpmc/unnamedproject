import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { getMe } from '../lib/api.js';
import { clearToken } from '../lib/auth.js';
import { useTheme } from '../lib/useTheme.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function UserMenu() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: getMe, staleTime: Infinity });

  const initial = me?.email?.[0]?.toUpperCase() ?? 'U';
  const label = me?.email?.split('@')[0] ?? '…';
  const isDark = theme === 'unnamed-dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Account menu"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-tint text-[11px] font-semibold text-on-accent-soft">
            {initial}
          </div>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{label}</span>
          <ChevronDown size={14} className="shrink-0 text-faint-fg" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-48">
        <DropdownMenuItem onClick={toggleTheme}>
          {isDark ? <Sun size={14} className="mr-2" /> : <Moon size={14} className="mr-2" />}
          {isDark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings size={14} className="mr-2" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => { clearToken(); navigate('/login', { replace: true }); }}
          className="text-muted-foreground"
        >
          <LogOut size={14} className="mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
