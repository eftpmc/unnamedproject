import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useProjectCapabilities } from './useProjectCapabilities.js';
import * as api from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  getProjectCapabilities: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useProjectCapabilities', () => {
  beforeEach(() => {
    vi.mocked(api.getProjectCapabilities).mockResolvedValue({
      has_remotion: true,
      has_media: false,
    });
  });

  it('returns studio tab when has_remotion is true', async () => {
    const { result } = renderHook(() => useProjectCapabilities('proj-1'), { wrapper });
    await waitFor(() => expect(result.current.tabs.length).toBeGreaterThan(0));
    expect(result.current.tabs.some(t => t.id === 'studio')).toBe(true);
  });

  it('returns no extra tabs when all capabilities are false', async () => {
    vi.mocked(api.getProjectCapabilities).mockResolvedValue({
      has_remotion: false,
      has_media: false,
    });
    const { result } = renderHook(() => useProjectCapabilities('proj-2'), { wrapper });
    await waitFor(() => result.current.isLoaded);
    expect(result.current.tabs).toEqual([]);
  });
});
