import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Settings from './Settings.js';

vi.mock('../lib/api.js', () => ({
  getConnections: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue([]),
  getMemory: vi.fn().mockResolvedValue([]),
  getScheduledTasks: vi.fn().mockResolvedValue([]),
  getSettings: vi.fn().mockResolvedValue({
    projects_root: '/tmp/projects',
    permission_profile: 'fast',
  }),
  createConnection: vi.fn(),
  deleteConnection: vi.fn(),
  updateSettings: vi.fn(),
  deleteScheduledTask: vi.fn(),
  runScheduledTask: vi.fn(),
  getGoogleStatus: vi.fn().mockResolvedValue({}),
  getAgentProviders: vi.fn().mockResolvedValue([]),
}));

function renderSettings() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Settings', () => {
  it('renders the permission profile control', async () => {
    renderSettings();

    expect(await screen.findByText('Permissions')).toBeInTheDocument();
    expect(screen.getByText('Permission profile')).toBeInTheDocument();
    expect(screen.getByText('Fast')).toBeInTheDocument();
  });
});
