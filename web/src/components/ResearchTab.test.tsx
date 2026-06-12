import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResearchTab from './ResearchTab.js';

vi.mock('../lib/api.js', () => ({
  getResearchFiles: vi.fn().mockResolvedValue({
    files: [
      { name: 'ai-landscape.md', title: 'Ai Landscape', createdAt: Date.now() - 3600_000 },
      { name: 'market-analysis.md', title: 'Market Analysis', createdAt: Date.now() - 7200_000 },
    ],
  }),
  getResearchFile: vi.fn().mockResolvedValue('# AI Landscape\n\nSome research findings.'),
}));

const project = {
  id: 'proj-1',
  name: 'Test Project',
  description: null,
  repo_path: null,
  enabled_connection_ids: [],
};

function renderTab() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ResearchTab project={project} />
    </QueryClientProvider>
  );
}

describe('ResearchTab', () => {
  it('renders the list of research files', async () => {
    renderTab();
    expect(await screen.findByText('Ai Landscape')).toBeInTheDocument();
    expect(screen.getByText('Market Analysis')).toBeInTheDocument();
  });

  it('selects the first file by default and shows its content', async () => {
    renderTab();
    expect(await screen.findByText(/AI Landscape/)).toBeInTheDocument();
    expect(screen.getByText(/Some research findings/)).toBeInTheDocument();
  });

  it('switches content when a different file is clicked', async () => {
    const { getResearchFile } = await import('../lib/api.js');
    vi.mocked(getResearchFile).mockImplementation(async (_projectId, filename) =>
      filename === 'market-analysis.md'
        ? '# Market Analysis\n\nMarket data here.'
        : '# AI Landscape\n\nSome research findings.'
    );
    renderTab();
    await screen.findByText('Ai Landscape');
    await userEvent.click(screen.getByText('Market Analysis'));
    expect(await screen.findByText(/Market data here/)).toBeInTheDocument();
  });

  it('shows empty state when no files exist', async () => {
    const { getResearchFiles } = await import('../lib/api.js');
    (getResearchFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ files: [] });
    renderTab();
    expect(await screen.findByText('No research files yet')).toBeInTheDocument();
  });
});
