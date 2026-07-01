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
  getToolPackages: vi.fn().mockResolvedValue([]),
  testToolPackage: vi.fn(),
  installToolPackage: vi.fn(),
  disableToolPackage: vi.fn(),
  createAgentProvider: vi.fn(),
  deleteAgentProvider: vi.fn(),
  testAgentProvider: vi.fn(),
  getGoogleAuthUrl: vi.fn(),
  disconnectGoogle: vi.fn(),
  enableChrome: vi.fn(),
  disableChrome: vi.fn(),
  getChromeStatus: vi.fn().mockResolvedValue({ extensionConnected: false }),
  getVaultEntries: vi.fn().mockResolvedValue([]),
  setVaultEntry: vi.fn(),
  deleteVaultEntry: vi.fn(),
  importVaultEntries: vi.fn(),
  testConnection: vi.fn(),
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
    expect(screen.getByText('Normal')).toBeInTheDocument();
  });
});
