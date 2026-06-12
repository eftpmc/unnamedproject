import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudioTab from './StudioTab.js';
import type { Project } from '../types.js';

vi.mock('../lib/api.js', () => ({
  getProjectMedia: vi.fn(),
  mediaFileUrl: (projectId: string, filename: string) => `/projects/${projectId}/media/${filename}`,
}));

import { getProjectMedia } from '../lib/api.js';

const project: Project = {
  id: 'proj-1',
  name: 'Vid Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <StudioTab project={project} />
    </QueryClientProvider>,
  );
}

describe('StudioTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state when no videos exist', async () => {
    vi.mocked(getProjectMedia).mockResolvedValue({ files: [] });

    renderTab();

    expect(await screen.findByText(/no videos yet/i)).toBeInTheDocument();
  });

  it('renders a video element for each file', async () => {
    vi.mocked(getProjectMedia).mockResolvedValue({
      files: [{ name: 'clip.mp4', url: '/projects/proj-1/media/clip.mp4', createdAt: 1700000000000 }],
    });

    renderTab();

    expect(await screen.findByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText('clip.mp4').previousElementSibling?.tagName).toBe('VIDEO');
  });
});
