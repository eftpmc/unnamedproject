import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppSidebar from './Sidebar.js';

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
);

describe('AppSidebar', () => {
  it('renders icon-only nav items by default (collapsed)', () => {
    render(wrap(<AppSidebar pinned={false} onTogglePin={() => {}} />));
    expect(screen.queryByText('Chats')).not.toBeInTheDocument();
  });

  it('shows labels when pinned open', () => {
    render(wrap(<AppSidebar pinned={true} onTogglePin={() => {}} />));
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });
});
