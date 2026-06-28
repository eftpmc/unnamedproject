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
    render(wrap(<AppSidebar expanded={false} onToggle={() => {}} />));
    // Icons present, labels hidden
    expect(screen.queryByText('Chats')).not.toBeInTheDocument();
  });

  it('shows labels when expanded', () => {
    render(wrap(<AppSidebar expanded={true} onToggle={() => {}} />));
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });
});
