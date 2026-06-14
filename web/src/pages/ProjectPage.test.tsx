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
  getProjectCapabilities: vi.fn().mockResolvedValue({ has_remotion: false, has_media: false, has_graph: false, has_research: false }),
  getProjectArtifacts: vi.fn().mockResolvedValue({ artifacts: [] }),
  getChats: vi.fn().mockResolvedValue([
    {
      id: 'chat-1',
      title: 'Fix the render bug',
      effort: 'low',
      model: null,
      pinned_project_id: 'proj-1',
      created_at: Date.now() - 3600_000,
      updated_at: Date.now() - 3600_000,
    },
    {
      id: 'chat-2',
      title: 'Other project chat',
      effort: 'low',
      model: null,
      pinned_project_id: 'proj-other',
      created_at: Date.now() - 7200_000,
      updated_at: Date.now() - 7200_000,
    },
  ]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  getProjectFile: vi.fn().mockResolvedValue(null),
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
    expect(await screen.findByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('does not show dynamic studio tab when capabilities are false', async () => {
    renderPage('/projects/proj-1');
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('shows the Artifacts tab without capability-specific tabs', async () => {
    renderPage('/projects/proj-1');
    expect(await screen.findByRole('link', { name: 'Artifacts' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Research' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('shows only chats pinned to this project in the Chats tab', async () => {
    renderPage('/projects/proj-1/chats');
    expect(await screen.findByText('Fix the render bug')).toBeInTheDocument();
    expect(screen.queryByText('Other project chat')).not.toBeInTheDocument();
  });

  it('shows empty state when no chats are pinned to this project', async () => {
    const { getChats } = await import('../lib/api.js');
    (getChats as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    renderPage('/projects/proj-1/chats');
    expect(await screen.findByText('No chats yet')).toBeInTheDocument();
  });

  it('shows active campaign hero when a campaign is running', async () => {
    const { getProjectCampaigns } = await import('../lib/api.js');
    (getProjectCampaigns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'camp-1',
        project_id: 'proj-1',
        session_id: null,
        title: 'Implement auth flow',
        status: 'running' as const,
        created_at: Date.now() - 300_000,
        completed_at: null,
      },
    ]);
    renderPage('/projects/proj-1');
    expect(await screen.findByText('Active Campaign')).toBeInTheDocument();
    expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
  });

  it('shows recent campaigns section with campaign title on overview', async () => {
    const { getProjectCampaigns } = await import('../lib/api.js');
    (getProjectCampaigns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'camp-2',
        project_id: 'proj-1',
        session_id: null,
        title: 'Add dark mode',
        status: 'done' as const,
        created_at: Date.now() - 3600_000,
        completed_at: Date.now() - 1800_000,
      },
    ]);
    renderPage('/projects/proj-1');
    expect(await screen.findByText('Recent Campaigns')).toBeInTheDocument();
    expect(screen.getByText('Add dark mode')).toBeInTheDocument();
  });

  it('shows recent chats section on overview when chats are pinned', async () => {
    renderPage('/projects/proj-1');
    expect(await screen.findByText('Recent Chats')).toBeInTheDocument();
    expect(screen.getByText('Fix the render bug')).toBeInTheDocument();
  });

  it('shows nothing here yet empty panel when no campaigns and no chats', async () => {
    const { getChats, getProjectCampaigns } = await import('../lib/api.js');
    (getChats as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (getProjectCampaigns as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    renderPage('/projects/proj-1');
    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
  });
});
