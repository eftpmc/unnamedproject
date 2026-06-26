import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const { login, getChats, createChat, getChatStatus, sendMessage, getSpaceItems } = await import('./api');

const mockResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

beforeEach(() => {
  mockFetch.mockReset();
  vi.mocked(getToken).mockReturnValue('test-token');
});

describe('api', () => {
  it('login posts credentials and returns token', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ token: 'jwt-abc' }));
    const result = await login('user@test.com', 'password');
    expect(result).toBe('jwt-abc');
    expect(mockFetch).toHaveBeenCalledWith('/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'user@test.com', password: 'password' }),
    }));
  });

  it('getChats includes auth header', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getChats();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('createChat returns new session id', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 'sess-1' }));
    const result = await createChat('My session');
    expect(result.id).toBe('sess-1');
  });

  it('getChatStatus fetches active state', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ active: true, turn: null, execution: null }));
    const result = await getChatStatus('sess-1');
    expect(result.active).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('/sessions/sess-1/status', expect.any(Object));
  });

  it('sendMessage uses multipart form data for attachments', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 'msg-1', role: 'user', content: 'See attached', created_at: 1 }));
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await sendMessage('sess-1', 'See attached', [file]);

    const [path, opts] = mockFetch.mock.calls[0];
    expect(path).toBe('/sessions/sess-1/messages');
    expect(opts.body).toBeInstanceOf(FormData);
    expect(opts.headers['Content-Type']).toBeUndefined();
    expect(opts.headers.Authorization).toBe('Bearer test-token');
  });

  it('getSpaceItems fetches the unified item list', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getSpaceItems('space-1');
    expect(mockFetch).toHaveBeenCalledWith('/spaces/space-1/items', expect.any(Object));
  });

});
