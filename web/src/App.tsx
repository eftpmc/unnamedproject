import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import ProjectPage from './pages/ProjectPage.js';
import PlanPage from './pages/PlanPage.js';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

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
      { path: 'spaces', element: <ProjectsPage /> },
      { path: 'spaces/:projectId', element: <ProjectPage /> },
      { path: 'spaces/:projectId/plans', element: <ProjectPage /> },
      { path: 'spaces/:projectId/files', element: <ProjectPage /> },
      { path: 'spaces/:projectId/settings', element: <ProjectPage /> },
      { path: 'spaces/:projectId/:tab', element: <ProjectPage /> },
      { path: 'spaces/:projectId/plans/:planId', element: <PlanPage /> },
      { path: 'projects', element: <Navigate to="/spaces" replace /> },
      { path: 'projects/:projectId', element: <Navigate to="/spaces/:projectId" replace /> },
      { path: 'projects/:projectId/plans/:planId', element: <Navigate to="/spaces/:projectId/plans/:planId" replace /> },
      { path: 'projects/:projectId/:tab', element: <Navigate to="/spaces/:projectId/:tab" replace /> },
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
