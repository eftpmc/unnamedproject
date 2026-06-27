import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SpacePage from './SpacePage.js';

vi.mock('../lib/api.js', () => ({
  getSpaces: vi.fn().mockResolvedValue([{ id: 'space-1', name: 'Test Space', description: 'A useful Space', enabled_connection_ids: [] }]),
  getDocuments: vi.fn().mockResolvedValue([
    { id: 'doc-1', space_id: 'space-1', path: 'notes.md', title: 'Release notes', type: 'note', status: 'draft', frontmatter: {}, source_session_id: null, created_at: 10, updated_at: 10 },
    { id: 'doc-2', space_id: 'space-1', path: 'workflow.md', title: 'Daily workflow', type: 'workflow', status: null, frontmatter: {}, source_session_id: null, created_at: 9, updated_at: 9 },
  ]),
  getProjects: vi.fn().mockResolvedValue([
    { id: 'proj-1', space_id: 'space-1', name: 'Web repo', repo_path: '/tmp/web', default_branch: 'main', origin: 'created', created_at: 8 },
  ]),
  getChats: vi.fn().mockResolvedValue([{ id: 'chat-1', title: 'Fix the render bug', effort: 'low', model: null, pinned_space_id: 'space-1', created_at: 1, updated_at: 2 }]),
  getConnections: vi.fn().mockResolvedValue([]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  createProject: vi.fn(),
  linkProject: vi.fn(),
  deleteProject: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
}));

vi.mock('../components/FileBrowser.js', () => ({ default: () => <div>Repository browser</div> }));
vi.mock('../components/DocumentView.js', () => ({ default: () => <div>Document editor</div> }));

function renderPage(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/spaces/:spaceId" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/chats" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/documents" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/documents/:docId" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/projects" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/projects/:projectId" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/triggers" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/settings" element={<SpacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SpacePage', () => {
  it('renders the Space overview with new tab bar', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByText('Test Space')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Triggers' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Items' })).not.toBeInTheDocument();
  });

  it('marks the Overview tab active on the space root route', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks the Chats tab active on the chats sub-route', async () => {
    renderPage('/spaces/space-1/chats');
    expect(await screen.findByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks the Documents tab active on the documents sub-route', async () => {
    renderPage('/spaces/space-1/documents');
    expect(await screen.findByRole('link', { name: 'Documents' })).toHaveAttribute('aria-current', 'page');
  });

  it('lists documents in the Documents tab', async () => {
    renderPage('/spaces/space-1/documents');
    expect(await screen.findByText('Release notes')).toBeInTheDocument();
    expect(screen.getByText('Daily workflow')).toBeInTheDocument();
  });

  it('shows only chats pinned to the Space', async () => {
    renderPage('/spaces/space-1/chats');
    expect(await screen.findByText('Fix the render bug')).toBeInTheDocument();
  });

  it('lists projects in the Projects tab', async () => {
    renderPage('/spaces/space-1/projects');
    expect(await screen.findByText('Web repo')).toBeInTheDocument();
  });

  it('shows the persistent space-name header on every tab', async () => {
    renderPage('/spaces/space-1/documents');
    expect(await screen.findByRole('heading', { name: 'Test Space' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Documents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Test Space' })).not.toBeInTheDocument();
  });

  it('does not show the space description anywhere', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByRole('heading', { name: 'Test Space' })).toBeInTheDocument();
    expect(screen.queryByText('A useful Space')).not.toBeInTheDocument();
  });
});
