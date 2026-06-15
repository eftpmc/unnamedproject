jest.mock('../../lib/store', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

import { useAppStore } from '../../lib/store';
import { apiFetch, uploadMessage } from '../../lib/api';

const mockGetState = useAppStore.getState as jest.Mock;
const signOut = jest.fn();

function stubStore(overrides: { serverUrl?: string | null; token?: string } = {}) {
  mockGetState.mockReturnValue({
    serverUrl: 'serverUrl' in overrides ? overrides.serverUrl : 'http://localhost:3000',
    token: overrides.token ?? 'tok123',
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
