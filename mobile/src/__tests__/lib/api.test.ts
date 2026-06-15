jest.mock('../../lib/store', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

import { useAppStore } from '../../lib/store';
import { apiFetch, uploadMessage } from '../../lib/api';

const mockGetState = useAppStore.getState as jest.Mock;
const signOut = jest.fn();

function stubStore(overrides: { serverUrl?: string | null; token?: string | null } = {}) {
  mockGetState.mockReturnValue({
    serverUrl: 'serverUrl' in overrides ? overrides.serverUrl : 'http://localhost:3000',
    token: 'token' in overrides ? overrides.token : 'tok123',
    signOut,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

it('injects Authorization header', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ data: 1 }),
  });
  await apiFetch('/test');
  expect(global.fetch).toHaveBeenCalledWith(
    'http://localhost:3000/test',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
    })
  );
});

it('calls signOut and throws on 401', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 401,
    text: async () => 'Unauthorized',
  });
  await expect(apiFetch('/secure')).rejects.toThrow('Unauthorized');
  expect(signOut).toHaveBeenCalled();
});

it('throws on non-401 error', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 500,
    text: async () => 'Internal Server Error',
  });
  await expect(apiFetch('/fail')).rejects.toThrow('500');
  expect(signOut).not.toHaveBeenCalled();
});

it('throws when no serverUrl', async () => {
  stubStore({ serverUrl: undefined });
  await expect(apiFetch('/any')).rejects.toThrow('No server URL');
});

it('sends no Authorization header when token is null', async () => {
  stubStore({ token: undefined });
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null }, json: async () => ({}),
  });
  await apiFetch('/test');
  const callHeaders = (global.fetch as jest.Mock).mock.calls[0][1].headers as Record<string, string>;
  expect(callHeaders['Authorization']).toBeUndefined();
});

it('uploadMessage posts multipart form and returns json', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true, status: 200, json: async () => ({ id: 'msg1' }),
  });
  const result = await uploadMessage('sess1', 'hello', []);
  expect(result).toEqual({ id: 'msg1' });
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
  expect(url).toBe('http://localhost:3000/sessions/sess1/messages');
  expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok123');
  expect(init.body).toBeInstanceOf(FormData);
});

it('uploadMessage calls signOut and throws on 401', async () => {
  stubStore();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 401, text: async () => 'Unauthorized',
  });
  await expect(uploadMessage('sess1', 'hi', [])).rejects.toThrow('Unauthorized');
  expect(signOut).toHaveBeenCalled();
});
