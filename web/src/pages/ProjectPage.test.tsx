import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProjectPage from './ProjectPage.js';
import { PROJECT_TYPE_REGISTRY } from '../projectTypes.js';
import type { Project } from '../types.js';

vi.mock('../lib/api.js', () => ({
  getProjects: vi.fn().mockResolvedValue([
    {
      id: 'proj-1',
      name: 'Test Project',
      description: null,
      repo_path: null,
      enabled_connection_ids: [],
      type: 'widget',
    },
  ]),
  getProjectCampaigns: vi.fn().mockResolvedValue([]),
  createChat: vi.fn(),
  updateChatConfig: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('../components/FileBrowser.js', () => ({ default: () => <div>FileBrowser</div> }));

function WidgetTab({ project }: { project: Project }) {
  return <div>Widget tab for {project.name}</div>;
}

function renderPage(path: string) {
  const queryClient = new QueryClient();
  PROJECT_TYPE_REGISTRY.widget = { extraTabs: [{ id: 'widgets', label: 'Widgets', component: WidgetTab }] };
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

describe('ProjectPage extra tabs', () => {
  it('shows the registry-provided extra tab', async () => {
    renderPage('/projects/proj-1');
    expect(await screen.findByRole('tab', { name: 'Widgets' })).toBeInTheDocument();
  });

  it('renders extra tab content when selected via URL', async () => {
    renderPage('/projects/proj-1/widgets');
    expect(await screen.findByText('Widget tab for Test Project')).toBeInTheDocument();
  });
});
