import { useNavigate } from 'react-router-dom';
import { Moon, Sun, Settings } from 'lucide-react';
import { useTheme } from '../lib/useTheme.js';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../lib/api.js';
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="User menu" className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors hover:bg-background/60 focus-visible:outline-none">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-xs font-semibold text-background">
            {initial}
          </div>
          <span className="flex-1 truncate text-sm font-medium">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-48">
        <DropdownMenuItem onClick={toggleTheme}>
          {theme === 'unnamed-dark'
            ? <Sun size={14} className="mr-2" />
            : <Moon size={14} className="mr-2" />}
          {theme === 'unnamed-dark' ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings size={14} className="mr-2" />
          Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
