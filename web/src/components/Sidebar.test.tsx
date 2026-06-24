import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from './Sidebar.js';
import { SidebarProvider } from './ui/sidebar.js';

vi.mock('../lib/api.js', () => ({
  createChat: vi.fn(),
  getActiveSessions: vi.fn().mockResolvedValue({ ids: [] }),
  getChats: vi.fn().mockResolvedValue([
    { id: 'chat-1', title: 'My recent chat', effort: 'low', model: null, pinned_space_id: 'space-1', created_at: 1, updated_at: 2 },
  ]),
  getSpaces: vi.fn().mockResolvedValue([
    { id: 'space-1', name: 'Test Space', description: null, enabled_connection_ids: [] },
  ]),
}));

vi.mock('../lib/useWsStatus.js', () => ({ useWsStatus: () => 'connected' }));
vi.mock('./UserMenu.js', () => ({ default: () => <div>User menu</div> }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false, media: query, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  });
});

function renderSidebar(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <SidebarProvider>
          <Sidebar />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  it('shows the unnamed logo on a top-level route', async () => {
    renderSidebar('/c');
    expect(await screen.findByText('unnamed')).toBeInTheDocument();
  });

  it('shows the unnamed logo even when inside a space route', async () => {
    renderSidebar('/spaces/space-1/plans');
    expect(await screen.findByText('unnamed')).toBeInTheDocument();
    // Space-specific nav links must not appear in the sidebar
    expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plans' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pipelines' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('always shows Chats and Spaces nav items', async () => {
    renderSidebar('/spaces/space-1');
    expect(await screen.findByRole('link', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spaces' })).toBeInTheDocument();
  });

  it('shows recent chats even when on a space route', async () => {
    renderSidebar('/spaces/space-1/items');
    expect(await screen.findByText('My recent chat')).toBeInTheDocument();
    // Space name subtitle is shown alongside the chat
    expect(screen.getByText('Test Space')).toBeInTheDocument();
  });
});
