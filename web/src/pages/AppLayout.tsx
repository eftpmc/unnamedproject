import { useEffect } from 'react';
import { Outlet, useParams, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.js';
import ChatView from '../components/ChatView.js';
import EmptyState from '../components/EmptyState.js';
import { createChat } from '../lib/api.js';
import { connect } from '../lib/ws.js';

const PAGE_ROUTES = ['/chats', '/projects', '/settings'];

export default function AppLayout() {
  const { chatId } = useParams<{ chatId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    connect();
  }, []);

  async function handleNewChat() {
    const { id } = await createChat();
    navigate(`/c/${id}`);
  }

  const isPageRoute = PAGE_ROUTES.includes(location.pathname);

  const mainContent = isPageRoute
    ? <Outlet />
    : chatId
      ? <ChatView chatId={chatId} />
      : <EmptyState onNewChat={handleNewChat} />;

  return (
    <div className="flex h-full gap-2 bg-muted/45 p-3 text-foreground">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-background/58 shadow-sm backdrop-blur">
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
        {mainContent}
      </main>
    </div>
  );
}
