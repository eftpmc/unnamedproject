import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid } from 'lucide-react';
import { getChats, createChat } from '../lib/api.js';
import { timeAgo, cn } from '../lib/utils.js';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import UserMenu from './UserMenu.js';
import type { Session } from '../types.js';

const RECENT_COUNT = 5;

interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export default function Sidebar({ className, onNavigate }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isMobile, setOpenMobile } = useSidebar();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  async function handleNewChat() {
    try {
      const { id } = await createChat();
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/c/${id}`);
      closeSidebar();
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  const activeChatId = location.pathname.startsWith('/c/')
    ? location.pathname.split('/')[2]
    : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const recentChats = chats.slice(0, RECENT_COUNT);

  function closeSidebar() {
    onNavigate?.();
    if (isMobile) setOpenMobile(false);
  }

  function go(path: string) {
    navigate(path);
    closeSidebar();
  }

  return (
    <SidebarRoot className={cn('border-r border-sidebar-border bg-sidebar', className)} collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 py-3">
        <div className="flex items-center gap-2 px-1">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background shadow-sm">
            u
          </div>
          <span className="text-sm font-semibold">unnamed</span>
        </div>
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="pb-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <NavItem
                icon={<MessagesSquare size={15} strokeWidth={1.75} />}
                label="Chats"
                active={isActive('/chats')}
                onClick={() => go('/chats')}
              />
              <NavItem
                icon={<LayoutGrid size={15} strokeWidth={1.75} />}
                label="Projects"
                active={isActive('/projects')}
                onClick={() => go('/projects')}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

      {/* Recent chats */}
      {recentChats.length > 0 && (
        <SidebarGroup className="min-h-0 flex-1 pt-1">
          <SidebarGroupLabel className="h-6 px-2">Recent</SidebarGroupLabel>
          <SidebarGroupContent className="min-h-0 flex-1">
          <div className="min-w-0 overflow-hidden">
            <ul className="flex w-full max-w-full min-w-0 flex-col gap-0 overflow-hidden pb-2 pr-1">
              {recentChats.map(chat => (
                <li key={chat.id} className="w-full max-w-full min-w-0">
                  <button
                    aria-label={`Open recent chat ${chat.title ?? 'Untitled chat'}, updated ${timeAgo(chat.updated_at)}`}
                    onClick={() => go(`/c/${chat.id}`)}
                    className={cn(
                      'flex w-full max-w-full min-w-0 flex-col rounded-xl px-3 py-2 text-left transition-colors hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                      activeChatId === chat.id && 'bg-background/80 shadow-xs ring-1 ring-border/50',
                    )}
                  >
                    <span className="block w-full truncate text-xs font-medium">{chat.title ?? 'Untitled chat'}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          </SidebarGroupContent>
        </SidebarGroup>
      )}

      {recentChats.length === 0 && <div className="flex-1" />}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 px-2 py-2">
        <UserMenu />
      </SidebarFooter>
    </SidebarRoot>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={onClick}
        className={cn(
          'h-9 rounded-xl px-3 font-medium',
          active && 'bg-background text-foreground shadow-xs ring-1 ring-border/50',
        )}
      >
        {icon}
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
