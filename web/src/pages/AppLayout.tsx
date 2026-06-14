import { useEffect, useState, type CSSProperties } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import Sidebar from '../components/Sidebar.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import { createChat } from '../lib/api.js';
import { connect, subscribe } from '../lib/ws.js';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import type { WSApprovalRequested, WSExecutionUpdate } from '../types.js';

const PAGE_ROUTES = ['/chats', '/projects', '/settings', '/activity', '/pipelines'];

/** Mobile-only top bar: hamburger (left) · brand mark (centered) · spacer. */
function MobileTopbar() {
  const { toggleSidebar } = useSidebar();
  return (
    <header className="relative flex shrink-0 items-center justify-between border-b border-border-soft bg-background px-4 py-2.5 md:hidden">
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Open navigation"
        className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-fg-soft transition-colors hover:bg-accent hover:text-foreground"
      >
        <Menu size={18} strokeWidth={2} />
      </button>
      <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm">
          u
        </div>
      </div>
      <div className="size-9 shrink-0" aria-hidden />
    </header>
  );
}

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // executionId → approvalId for pending approvals
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    connect();
    const unsub = subscribe(event => {
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, e.approvalId));
      } else if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'running' || e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => {
            const next = new Map(prev);
            next.delete(e.executionId);
            return next;
          });
        }
      }
    });
    return unsub;
  }, []);

  async function handleNewChat() {
    const { id } = await createChat();
    navigate(`/c/${id}`);
  }

  const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState onNewChat={handleNewChat} />;

  return (
    <SidebarProvider
      className="h-full min-h-0 bg-muted/45 text-foreground"
      style={{ '--sidebar-width': '14rem' } as CSSProperties}
    >
      <Sidebar pendingApprovalCount={pendingApprovals.size} />
      <SidebarInset className="relative min-h-0 min-w-0 overflow-hidden bg-background/58 backdrop-blur">
        <MobileTopbar />
        {mainContent}
      </SidebarInset>
    </SidebarProvider>
  );
}
