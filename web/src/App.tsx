import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { TooltipProvider } from '@/components/ui/tooltip';

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
      { path: 'projects/:projectId/chats', element: <ProjectPage /> },
      { path: 'projects/:projectId/documents', element: <Navigate to="/library" replace /> },
      { path: 'library', element: <DocumentsPage /> },
      { path: 'library/:documentId', element: <DocumentPage /> },
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


export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
