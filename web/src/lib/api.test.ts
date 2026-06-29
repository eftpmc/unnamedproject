import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, setToken } from './auth';

vi.mock('./auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

const { login, getChats, createChat, getChatStatus, sendMessage, getDocuments, getProjects: getTopLevelProjects, createTopLevelProject, getAllDocuments, getAllTriggers } = await import('./api');

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

  it('getDocuments constructs the correct URL without params', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getDocuments('proj-1');
    expect(mockFetch).toHaveBeenCalledWith('/projects/proj-1/documents', expect.any(Object));
  });

  it('getDocuments appends type query param when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));
    await getDocuments('proj-1', { type: 'playbook' });
    expect(mockFetch).toHaveBeenCalledWith('/projects/proj-1/documents?type=playbook', expect.any(Object));
  });

});

// Top-level API tests
describe('Top-level API functions', () => {
  describe('getProjects', () => {
    it('calls GET /projects', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      const result = await getTopLevelProjects();
      expect(mockFetch).toHaveBeenCalledWith('/projects', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }));
      expect(result).toEqual([]);
    });
  });

  describe('createTopLevelProject', () => {
    it('calls POST /projects with name', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ id: '1', name: 'test', space_id: 'sp1', repo_path: '', default_branch: null, origin: 'created', created_at: 0 }));
      await createTopLevelProject({ name: 'test' });
      expect(mockFetch).toHaveBeenCalledWith('/projects', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('getAllDocuments', () => {
    it('calls GET /documents', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      await getAllDocuments();
      expect(mockFetch).toHaveBeenCalledWith('/documents', expect.anything());
    });
  });

  describe('getAllTriggers', () => {
    it('calls GET /triggers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([]));
      await getAllTriggers();
      expect(mockFetch).toHaveBeenCalledWith('/triggers', expect.anything());
    });
  });
});
