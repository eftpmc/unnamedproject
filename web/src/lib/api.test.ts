import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const { login, getChats, createChat, getProjectMedia, mediaFileUrl } = await import('./api');

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

  it('getProjectMedia fetches the project media list', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) });
    await getProjectMedia('proj-1');
    expect(mockFetch).toHaveBeenCalledWith('/projects/proj-1/media', expect.any(Object));
  });

  it('mediaFileUrl builds an encoded url with token', () => {
    const url = mediaFileUrl('proj-1', 'my clip.mp4');
    expect(url).toBe('/projects/proj-1/media/my%20clip.mp4?token=test-token');
  });

  it('mediaFileUrl omits the token query string when unauthenticated', () => {
    vi.mocked(getToken).mockReturnValue(null);
    const url = mediaFileUrl('proj-1', 'my clip.mp4');
    expect(url).toBe('/projects/proj-1/media/my%20clip.mp4');
    expect(url).not.toContain('?token=');
  });
});
