import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ArtifactsTab from './ArtifactsTab.js';
import type { Project, ProjectArtifact } from '../types.js';

vi.mock('../lib/api.js', () => ({
  getProjectArtifacts: vi.fn(),
  getArtifactContent: vi.fn(),
}));

import { getArtifactContent, getProjectArtifacts } from '../lib/api.js';

const project: Project = {
  id: 'proj-1',
  name: 'Artifacts Project',
  description: null,
  enabled_connection_ids: [],
};

const artifacts: ProjectArtifact[] = [
  {
    id: 'artifact-1',
    project_id: 'proj-1',
    kind: 'research',
    title: 'Market Analysis',
    description: null,
    status: 'review',
    mime_type: 'text/markdown',
    path: 'research/market-analysis.md',
    url: null,
    content_url: '/projects/proj-1/research/market-analysis.md',
    metadata: {},
    source_plan_id: null,
    source_step_id: null,
    created_at: Math.floor(Date.now() / 1000) - 60,
  },
  {
    id: 'artifact-2',
    project_id: 'proj-1',
    kind: 'media',
    title: 'Launch Preview',
    description: null,
    status: 'ready',
    mime_type: 'video/mp4',
    path: 'media/launch.mp4',
    url: '/projects/proj-1/media/launch.mp4',
    content_url: '/projects/proj-1/media/launch.mp4',
    metadata: {},
    source_plan_id: null,
    source_step_id: null,
    created_at: Math.floor(Date.now() / 1000) - 120,
  },
];

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ArtifactsTab project={project} />
    </QueryClientProvider>,
  );
}

describe('ArtifactsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getProjectArtifacts).mockResolvedValue({ artifacts });
    vi.mocked(getArtifactContent).mockResolvedValue('# Market Analysis\n\nFindings here.');
  });

  it('shows an empty state when no artifacts exist', async () => {
    vi.mocked(getProjectArtifacts).mockResolvedValue({ artifacts: [] });
    renderTab();
    expect(await screen.findByText('No artifacts yet')).toBeInTheDocument();
  });

  it('renders generic artifacts and filters by kind', async () => {
    renderTab();
    expect(await screen.findAllByText('Market Analysis')).not.toHaveLength(0);
    expect(screen.getByText('Launch Preview')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Research' }));
    expect(screen.getAllByText('Market Analysis')).not.toHaveLength(0);
    expect(screen.queryByText('Launch Preview')).not.toBeInTheDocument();
  });

  it('loads text artifact preview through content_url', async () => {
    renderTab();
    expect(await screen.findByText(/Findings here/)).toBeInTheDocument();
    expect(getArtifactContent).toHaveBeenCalledWith('/projects/proj-1/research/market-analysis.md');
  });
});
