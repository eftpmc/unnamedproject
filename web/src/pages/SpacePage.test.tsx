import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SpacePage from './SpacePage.js';

vi.mock('../lib/api.js', () => ({
  getSpaces: vi.fn().mockResolvedValue([{ id: 'space-1', name: 'Test Space', description: 'A useful Space', enabled_connection_ids: [] }]),
  getSpaceItems: vi.fn().mockResolvedValue([
    { id: 'repo-1', space_id: 'space-1', type: 'repo', name: 'Web repo', repo_path: '/tmp/web', default_branch: 'main', source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 10 },
    { id: 'note-1', space_id: 'space-1', type: 'note', name: 'Release notes', content: '# Ready', source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 9 },
  ]),
  getSpacePlans: vi.fn().mockResolvedValue([]),
  getChats: vi.fn().mockResolvedValue([{ id: 'chat-1', title: 'Fix the render bug', effort: 'low', model: null, pinned_space_id: 'space-1', created_at: 1, updated_at: 2 }]),
  getSpacePipelines: vi.fn().mockResolvedValue({ pipelines: [] }),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  createSpaceItem: vi.fn(),
  deleteSpaceItem: vi.fn(),
  deleteSpacePipeline: vi.fn(),
  runSpacePipeline: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: vi.fn(),
  updateSpaceItem: vi.fn(),
  getItemContent: vi.fn(),
}));

vi.mock('../components/FileBrowser.js', () => ({ default: () => <div>Repository browser</div> }));

function renderPage(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/spaces/:spaceId" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/:section" element={<SpacePage />} />
          <Route path="/spaces/:spaceId/items/:itemId" element={<SpacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SpacePage', () => {
  it('renders the Space overview with tab bar visible', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByText('Test Space')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    // Tab bar is present
    expect(screen.getByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plans' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pipelines' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    // No tab is active on overview
    expect(screen.queryByRole('link', { name: 'Chats', current: 'page' })).not.toBeInTheDocument();
  });

  it('marks the Chats tab active on the chats sub-route', async () => {
    renderPage('/spaces/space-1/chats');
    expect(await screen.findByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Items', current: 'page' })).not.toBeInTheDocument();
  });

  it('marks the Items tab active on the items sub-route', async () => {
    renderPage('/spaces/space-1/items');
    expect(await screen.findByRole('link', { name: 'Items' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows only chats pinned to the Space', async () => {
    renderPage('/spaces/space-1/chats');
    expect(await screen.findByText('Fix the render bug')).toBeInTheDocument();
  });

  it('lists unified Items', async () => {
    renderPage('/spaces/space-1/items');
    expect(await screen.findByText('Web repo')).toBeInTheDocument();
    expect(screen.getByText('Release notes')).toBeInTheDocument();
  });

  it('drills into a repository Item without showing tab bar', async () => {
    renderPage('/spaces/space-1/items/repo-1');
    expect(await screen.findByText('Repository browser')).toBeInTheDocument();
    // ItemDetail renders its own shell — tab bar is not present
    expect(screen.queryByRole('link', { name: 'Pipelines' })).not.toBeInTheDocument();
  });
});
