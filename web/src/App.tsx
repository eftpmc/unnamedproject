import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import SpacesPage from './pages/SpacesPage.js';
import SpacePage from './pages/SpacePage.js';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function LegacyProjectRedirect({ suffix = '' }: { suffix?: string }) {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/spaces/${projectId}${suffix}`} replace />;
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/c" replace /> },
  { path: '/s', element: <Navigate to="/c" replace /> },
  { path: '/s/:sessionId', element: <Navigate to="/c" replace /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: 'c', element: null },
      { path: 'c/:chatId', element: null },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'activity', element: <Navigate to="/" replace /> },
      { path: 'spaces', element: <SpacesPage /> },
      { path: 'spaces/:spaceId', element: <SpacePage /> },
      { path: 'spaces/:spaceId/chats', element: <SpacePage /> },
      { path: 'spaces/:spaceId/items', element: <SpacePage /> },
      { path: 'spaces/:spaceId/items/:itemId', element: <SpacePage /> },
      { path: 'spaces/:spaceId/settings', element: <SpacePage /> },
      { path: 'projects', element: <Navigate to="/spaces" replace /> },
      { path: 'projects/:projectId', element: <LegacyProjectRedirect /> },
      { path: 'projects/:projectId/:tab', element: <LegacyProjectRedirect /> },
      { path: 'pipelines', element: <Navigate to="/spaces" replace /> },
      { path: 'settings', element: <Settings /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
