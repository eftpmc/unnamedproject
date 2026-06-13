import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const { login, getChats, createChat, getProjectArtifacts, getArtifactContent } = await import('./api');

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getToken).mockReturnValue('test-token');
});

describe('api', () => {
  it('login posts credentials and returns token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'jwt-abc' }),
    });
    const result = await login('user@test.com', 'password');
    expect(result).toBe('jwt-abc');
    expect(mockFetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@test.com', password: 'password' }),
    }));
  });

  it('getChats includes auth header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await getChats();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('createChat returns new session id', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'sess-1' }) });
    const result = await createChat('My session');
    expect(result.id).toBe('sess-1');
  });

  it('getProjectArtifacts fetches the project artifact list', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ artifacts: [] }) });
    await getProjectArtifacts('proj-1');
    expect(mockFetch).toHaveBeenCalledWith('/projects/proj-1/artifacts', expect.any(Object));
  });

  it('getArtifactContent fetches a generic artifact content url', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => '# Artifact' });
    const content = await getArtifactContent('/projects/proj-1/research/example.md');
    expect(content).toBe('# Artifact');
    expect(mockFetch).toHaveBeenCalledWith('/projects/proj-1/research/example.md', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
  });
});
