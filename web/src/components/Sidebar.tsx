import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, MessagesSquare, LayoutGrid } from 'lucide-react';
import { getChats, createChat } from '../lib/api.js';
import { timeAgo, cn } from '../lib/utils.js';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import UserMenu from './UserMenu.js';
import type { Session } from '../types.js';

const RECENT_COUNT = 5;

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const { data: chats = [] } = useQuery<Session[]>({
    queryKey: ['chats'],
    queryFn: getChats,
  });

  async function handleNewChat() {
    try {
      const { id } = await createChat();
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/c/${id}`);
    } catch (err) {
      console.error('Failed to create chat:', err);
    }
  }

  const activeChatId = location.pathname.startsWith('/c/')
    ? location.pathname.split('/')[2]
    : null;

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');

  const recentChats = chats.slice(0, RECENT_COUNT);

  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-hidden rounded-3xl bg-background/50 py-3 backdrop-blur">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 pb-3">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-semibold text-background shadow-sm">
          u
        </div>
        <span className="text-sm font-semibold">unnamed</span>
      </div>

      {/* New chat */}
      <div className="px-3 pb-2">
        <button
          onClick={handleNewChat}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          <Plus size={14} strokeWidth={2} />
          New chat
        </button>
      </div>

      <Separator className="mx-3 w-auto bg-border/50" />

      {/* Nav links */}
      <div className="px-2 py-2">
        <NavItem
          icon={<MessagesSquare size={15} strokeWidth={1.75} />}
          label="Chats"
          active={isActive('/chats')}
          onClick={() => navigate('/chats')}
        />
        <NavItem
          icon={<LayoutGrid size={15} strokeWidth={1.75} />}
          label="Projects"
          active={isActive('/projects')}
          onClick={() => navigate('/projects')}
        />
      </div>

      <div className="flex-1" />

      {/* Recent chats */}
      {recentChats.length > 0 && (
        <>
          <Separator className="mx-3 w-auto bg-border/50" />
          <div className="px-4 pb-1 pt-3 text-xs font-medium text-muted-foreground">Recent</div>
          <ScrollArea className="max-h-52">
            <div className="px-2 pb-2">
              {recentChats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => navigate(`/c/${chat.id}`)}
                  className={cn(
                    'mb-0.5 w-full rounded-xl px-3 py-2 text-left transition-colors',
                    activeChatId === chat.id
                      ? 'bg-background text-foreground shadow-xs ring-1 ring-border/50'
                      : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
                  )}
                >
                  <div className="truncate text-xs font-medium">{chat.title ?? 'Untitled chat'}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{timeAgo(chat.updated_at)}</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </>
      )}

      {/* User menu */}
      <Separator className="mx-3 w-auto bg-border/50" />
      <div className="px-2 pt-2">
        <UserMenu />
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-xs ring-1 ring-border/50'
          : 'text-muted-foreground hover:bg-background/65 hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
