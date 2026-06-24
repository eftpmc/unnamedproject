import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from './Sidebar.js';
import { SidebarProvider } from './ui/sidebar.js';

vi.mock('../lib/api.js', () => ({
  createChat: vi.fn(),
  getActiveSessions: vi.fn().mockResolvedValue({ ids: [] }),
  getChats: vi.fn().mockResolvedValue([]),
  getSpaces: vi.fn().mockResolvedValue([
    { id: 'space-1', name: 'Test Space', description: null, enabled_connection_ids: [] },
  ]),
  updateChatConfig: vi.fn(),
}));

vi.mock('../lib/useWsStatus.js', () => ({ useWsStatus: () => 'connected' }));
vi.mock('./UserMenu.js', () => ({ default: () => <div>User menu</div> }));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

describe('Sidebar', () => {
  it('renders Pipelines as a standalone Space destination', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/spaces/space-1/plans']}>
          <SidebarProvider>
            <Sidebar />
          </SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Test Space')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/spaces/space-1');
    expect(screen.getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/spaces/space-1/plans');
    expect(screen.getByRole('link', { name: 'Pipelines' })).toHaveAttribute('href', '/spaces/space-1/pipelines');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/spaces/space-1/settings');
  });
});
