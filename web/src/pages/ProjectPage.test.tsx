import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectPage from './ProjectPage.js';

vi.mock('../lib/api.js', () => ({
  getProjects: vi.fn().mockResolvedValue([
    {
      id: 'proj-1',
      name: 'Test Project',
      description: null,
      repo_path: null,
      enabled_connection_ids: [],
    },
  ]),
  getProjectCampaigns: vi.fn().mockResolvedValue([]),
  getProjectCapabilities: vi.fn().mockResolvedValue({ has_remotion: false, has_media: false }),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../components/FileBrowser.js', () => ({ default: () => <div>FileBrowser</div> }));

function renderPage(path: string) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/*" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectPage', () => {
  it('renders the project overview tab', async () => {
    renderPage('/projects/proj-1');
    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('does not show studio tab when capabilities are false', async () => {
    renderPage('/projects/proj-1');
    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Studio' })).not.toBeInTheDocument();
  });
});
