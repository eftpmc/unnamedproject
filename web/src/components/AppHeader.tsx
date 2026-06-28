/**
 * AppHeader — stub placeholder for Task 6.
 * Task 6 will fill in the full header (space/project selector, right controls).
 */
import { Menu, Bell } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface AppHeaderProps {
  onToggleSidebar: () => void;
  pendingApprovalCount: number;
  onOpenInbox: () => void;
}

export default function AppHeader({ onToggleSidebar, pendingApprovalCount, onOpenInbox }: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border-soft bg-background">
      {/* Logo / hamburger slot — always w-12 to align with sidebar */}
      <div className="flex w-12 shrink-0 items-center justify-center">
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
          )}
        >
          <Menu size={16} strokeWidth={1.75} />
        </button>
      </div>

      {/* Center / right — placeholder until Task 6 */}
      <div className="flex flex-1 items-center justify-end gap-2 px-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
          u
        </div>
        <button
          type="button"
          onClick={onOpenInbox}
          aria-label="Open inbox"
          className="relative grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell size={16} strokeWidth={1.75} />
          {pendingApprovalCount > 0 && (
            <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold text-warning-foreground">
              {pendingApprovalCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
