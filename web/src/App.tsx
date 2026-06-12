import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import ProjectPage from './pages/ProjectPage.js';
import CampaignPage from './pages/CampaignPage.js';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/c" replace /> },
  { path: '/s/:sessionId', element: <Navigate to="/c" replace /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: 'c', element: null },
      { path: 'c/:chatId', element: null },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      { path: 'projects/:projectId/campaigns', element: <ProjectPage /> },
      { path: 'projects/:projectId/files', element: <ProjectPage /> },
      { path: 'projects/:projectId/settings', element: <ProjectPage /> },
      { path: 'projects/:projectId/campaigns/:campaignId', element: <CampaignPage /> },
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
