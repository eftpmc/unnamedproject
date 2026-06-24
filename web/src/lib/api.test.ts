import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const { login, getChats, createChat, getChatStatus, sendMessage, getSpaceItems, getSpacePipelines } = await import('./api');

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

  it('getChatStatus fetches active state', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ active: true, turn: null, execution: null }) });
    const result = await getChatStatus('sess-1');
    expect(result.active).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/sessions/sess-1/status', expect.any(Object));
  });

  it('sendMessage uses multipart form data for attachments', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'msg-1', role: 'user', content: 'See attached', created_at: 1 }) });
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await sendMessage('sess-1', 'See attached', [file]);

    const [path, opts] = mockFetch.mock.calls[0];
    expect(path).toBe('/sessions/sess-1/messages');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('getSpaceItems fetches the unified item list', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await getSpaceItems('space-1');
    expect(mockFetch).toHaveBeenCalledWith('/spaces/space-1/items', expect.any(Object));
  });

  it('getSpacePipelines uses the Space-owned route', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ pipelines: [] }) });
    await getSpacePipelines('space-1');
    expect(mockFetch).toHaveBeenCalledWith('/spaces/space-1/pipelines', expect.any(Object));
  });
});
