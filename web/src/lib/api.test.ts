import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { login, getSessions, createSession } = await import('./api');

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

  it('getSessions includes auth header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await getSessions();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('createSession returns new session id', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'sess-1' }) });
    const result = await createSession('My session');
    expect(result.id).toBe('sess-1');
  });
});
