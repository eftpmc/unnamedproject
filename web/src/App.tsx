import { createBrowserRouter, RouterProvider, Navigate, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import RequireAuth from './components/RequireAuth.js';
import Login from './pages/Login.js';
import AppLayout from './pages/AppLayout.js';
import HomePage from './pages/HomePage.js';
import Settings from './pages/Settings.js';
import ChatsPage from './pages/ChatsPage.js';
import ProjectsPage from './pages/ProjectsPage.js';
import NewProjectPage from './pages/NewProjectPage.js';
import ProjectPage from './pages/ProjectPage.js';
import DocumentsPage from './pages/DocumentsPage.js';
import DocumentPage from './pages/DocumentPage.js';
import TriggersPage from './pages/TriggersPage.js';
import MediaPage from './pages/MediaPage.js';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getProject } from './lib/api.js';
import type { Project } from './types.js';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/', element: <Navigate to="/home" replace /> },
  { path: '/s', element: <Navigate to="/c" replace /> },
  { path: '/s/:sessionId', element: <Navigate to="/c" replace /> },
  {
    path: '/',
    element: <RequireAuth><AppLayout /></RequireAuth>,
    children: [
      { path: 'home', element: <HomePage /> },
      { path: 'c', element: null },
      { path: 'c/:chatId', element: null },
      { path: 'chats', element: <ChatsPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/new', element: <NewProjectPage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      { path: 'projects/:projectId/files', element: <ProjectPage /> },
      { path: 'projects/:projectId/chats', element: <ProjectChatsRedirect /> },
      { path: 'documents', element: <DocumentsPage /> },
      { path: 'documents/:documentId', element: <DocumentPage /> },
      { path: 'media', element: <MediaPage /> },
      { path: 'triggers', element: <TriggersPage /> },
      { path: 'settings', element: <Navigate to="/settings/tools" replace /> },
      { path: 'settings/:section', element: <Settings /> },
      // Legacy redirects
      { path: 'spaces', element: <Navigate to="/projects" replace /> },
      { path: 'spaces/:spaceId', element: <Navigate to="/projects" replace /> },
      { path: 'spaces/:spaceId/*', element: <Navigate to="/projects" replace /> },
      { path: 'activity', element: <Navigate to="/home" replace /> },
    ],
  },
]);

function ProjectChatsRedirect() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: !!projectId,
  });

  if (!project) return null;
  return <Navigate to={`/chats?project=${project.space_id}`} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
