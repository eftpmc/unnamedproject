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
    { id: 'doc-1', space_id: 'space-1', type: 'document', name: 'Empty Doc', template_id: 'tpl_document', blocks: [{ type: 'text', content: '' }], source_session_id: null, source_plan_id: null, source_step_id: null, created_at: 8 },
  ]),
  listItemTemplates: vi.fn().mockResolvedValue([
    { id: 'tpl_document', user_id: null, kind: 'blocks', name: 'Document', blocks: [{ type: 'text', content: '' }], item_type: 'document', is_builtin: true, created_at: 1 },
  ]),
  getChats: vi.fn().mockResolvedValue([{ id: 'chat-1', title: 'Fix the render bug', effort: 'low', model: null, pinned_space_id: 'space-1', created_at: 1, updated_at: 2 }]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  createSpaceItem: vi.fn(),
  deleteSpaceItem: vi.fn(),
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
  it('renders the Space overview with tab bar and activity list', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByText('Test Space')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Items' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pipelines' })).not.toBeInTheDocument();
    // Stat cards removed — "Running" label no longer present
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
    // Activity items present
    expect(screen.getByText('Web repo')).toBeInTheDocument();
    expect(screen.getByText('Fix the render bug')).toBeInTheDocument();
  });

  it('marks the Overview tab active on the space root route', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks the Chats tab active on the chats sub-route', async () => {
    renderPage('/spaces/space-1/chats');
    expect(await screen.findByRole('link', { name: 'Chats' })).toHaveAttribute('aria-current', 'page');
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
    expect(screen.queryByRole('link', { name: 'Pipelines' })).not.toBeInTheDocument();
  });

  it('shows the persistent space-name header on every tab, with no per-tab title or breadcrumb', async () => {
    renderPage('/spaces/space-1/items');
    // Space name appears as the header title on a non-Overview tab.
    expect(await screen.findByRole('heading', { name: 'Test Space' })).toBeInTheDocument();
    // No separate "Items" page title.
    expect(screen.queryByRole('heading', { name: 'Items' })).not.toBeInTheDocument();
    // No breadcrumb link back to the space (the old single stray link).
    expect(screen.queryByRole('link', { name: 'Test Space' })).not.toBeInTheDocument();
  });

  it('does not show the space description anywhere', async () => {
    renderPage('/spaces/space-1');
    expect(await screen.findByRole('heading', { name: 'Test Space' })).toBeInTheDocument();
    expect(screen.queryByText('A useful Space')).not.toBeInTheDocument();
    expect(screen.queryByText('Everything related to this work, in one place.')).not.toBeInTheDocument();
  });

  it('shows the empty-state message for a document whose only block is blank', async () => {
    renderPage('/spaces/space-1/items/doc-1');
    expect(await screen.findByText('This document has no content yet. Ask the agent to fill it in.')).toBeInTheDocument();
  });
});
