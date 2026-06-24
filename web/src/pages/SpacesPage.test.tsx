import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SpacesPage from './SpacesPage.js';

vi.mock('../lib/api.js', () => ({
  getSpaces: vi.fn().mockResolvedValue([
    { id: 'space-1', name: 'word-counter-cli', description: 'A Node.js CLI tool', enabled_connection_ids: [] },
    { id: 'space-2', name: 'remotion-video', description: null, enabled_connection_ids: [] },
  ]),
  createSpace: vi.fn(),
  createSpaceItem: vi.fn(),
}));

vi.mock('../lib/usePageTitle.js', () => ({ usePageTitle: vi.fn() }));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SpacesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SpacesPage', () => {
  it('renders spaces as list rows', async () => {
    renderPage();
    expect(await screen.findByText('word-counter-cli')).toBeInTheDocument();
    expect(screen.getByText('remotion-video')).toBeInTheDocument();
    expect(screen.getByText('A Node.js CLI tool')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ items/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ chats/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ plans/)).not.toBeInTheDocument();
  });

  it('shows search input unconditionally', async () => {
    renderPage();
    expect(await screen.findByPlaceholderText('Filter Spaces...')).toBeInTheDocument();
  });

  it('filters spaces by name', async () => {
    renderPage();
    const input = await screen.findByPlaceholderText('Filter Spaces...');
    fireEvent.change(input, { target: { value: 'word' } });
    expect(screen.getByText('word-counter-cli')).toBeInTheDocument();
    expect(screen.queryByText('remotion-video')).not.toBeInTheDocument();
  });

  it('shows New Space button', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /new space/i })).toBeInTheDocument();
  });
});
