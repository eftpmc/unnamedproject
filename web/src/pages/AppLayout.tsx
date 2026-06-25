import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Sidebar from '../components/Sidebar.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import InboxPanel from '../components/InboxPanel.js';
import ErrorBoundary from '../components/ErrorBoundary.js';
import { getConnections } from '../lib/api.js';
import { connect, disconnect, subscribe } from '../lib/ws.js';
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar';
import type { Connection, Session, WSApprovalRequested, WSExecutionUpdate, WSTurnComplete } from '../types.js';

const PAGE_ROUTES = ['/chats', '/spaces', '/settings'];

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
  const queryClient = useQueryClient();

  // executionId → approvalId for pending approvals
  const [pendingApprovals, setPendingApprovals] = useState<Map<string, string>>(new Map());
  const [inboxOpen, setInboxOpen] = useState(false);

  // Keep a ref to chatId so the WS callback always has the current value
  const chatIdRef = useRef(chatId);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);

  const { data: connections = [] } = useQuery<Connection[]>({
    queryKey: ['connections'],
    queryFn: getConnections,
    staleTime: 60_000,
  });
  const hasLeadAgent = connections.some(c => c.purpose === 'claude_code' || c.purpose === 'codex');

  useEffect(() => {
    connect();
    const unsub = subscribe(event => {
      if (event.type === 'approval_requested') {
        const e = event as unknown as WSApprovalRequested;
        setPendingApprovals(prev => new Map(prev).set(e.executionId, e.approvalId));
        if ('Notification' in window) {
          const isCurrentChat = e.sessionId ? chatIdRef.current === e.sessionId : false;
          const isVisible = document.visibilityState === 'visible';
          if (!isCurrentChat || !isVisible) {
            const actionLabel = e.action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const fire = () => {
              const n = new Notification('Approval needed', {
                body: actionLabel,
                icon: '/favicon.ico',
                tag: `approval-${e.executionId}`,
                requireInteraction: true,
              });
              if (e.sessionId) n.onclick = () => { window.focus(); navigate(`/c/${e.sessionId}`); };
            };
            if (Notification.permission === 'granted') {
              fire();
            } else if (Notification.permission === 'default') {
              Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
            }
          }
        }
      } else if (event.type === 'execution_update') {
        const e = event as unknown as WSExecutionUpdate;
        if (e.status === 'running' || e.status === 'done' || e.status === 'error') {
          setPendingApprovals(prev => {
            const next = new Map(prev);
            next.delete(e.executionId);
            return next;
          });
        }
      } else if (event.type === 'turn_complete') {
        const e = event as unknown as WSTurnComplete;
        // Only notify for successful completions, not user-initiated stops
        if (e.status === 'done' && ('Notification' in window)) {
          const isCurrentChat = chatIdRef.current === e.sessionId;
          const isVisible = document.visibilityState === 'visible';
          if (!isCurrentChat || !isVisible) {
            const chats = queryClient.getQueryData<Session[]>(['chats']);
            const title = chats?.find(c => c.id === e.sessionId)?.title ?? 'Agent finished';
            const fire = () => new Notification('unnamed', { body: title, icon: '/favicon.ico', tag: e.sessionId });
            if (Notification.permission === 'granted') {
              fire();
            } else if (Notification.permission === 'default') {
              Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
            }
          }
        }
      }
    });
    return () => { unsub(); disconnect(); };
  }, [queryClient]);

  function handleApprovalResolved(executionId: string) {
    setPendingApprovals(prev => {
      const next = new Map(prev);
      next.delete(executionId);
      return next;
    });
  }

  const isPageRoute = PAGE_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'));

  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState hasLeadAgent={hasLeadAgent} />;

  return (
    <SidebarProvider
      className="h-full min-h-0 bg-muted/45 text-foreground"
      style={{ '--sidebar-width': '17rem' } as CSSProperties}
    >
      <Sidebar
        pendingApprovalCount={pendingApprovals.size}
        onOpenInbox={() => setInboxOpen(true)}
        hasLeadAgent={hasLeadAgent}
      />
      <SidebarInset className="relative min-h-0 min-w-0 overflow-hidden bg-background/58 backdrop-blur">
        <MobileTopbar />
        <ErrorBoundary key={location.pathname}>
          {mainContent}
        </ErrorBoundary>
      </SidebarInset>
      <InboxPanel
        open={inboxOpen}
        onOpenChange={setInboxOpen}
        pendingApprovals={pendingApprovals}
        onApprovalResolved={handleApprovalResolved}
      />
    </SidebarProvider>
  );
}
