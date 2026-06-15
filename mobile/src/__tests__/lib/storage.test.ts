import * as SecureStore from 'expo-secure-store';

jest.mock('expo-secure-store');

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;

import {
  getServerUrl, setServerUrl,
  getToken, setToken, clearToken,
  getSavedHosts, addSavedHost,
} from '../../lib/storage';

beforeEach(() => jest.clearAllMocks());

describe('token', () => {
  it('returns null when no token stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getToken()).toBeNull();
  });

  it('stores and retrieves token', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue();
    mockSecureStore.getItemAsync.mockResolvedValue('tok123');
    await setToken('tok123');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('auth_token', 'tok123');
    expect(await getToken()).toBe('tok123');
  });

  it('deletes token on clearToken', async () => {
    mockSecureStore.deleteItemAsync.mockResolvedValue();
    await clearToken();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('auth_token');
  });
});

describe('serverUrl', () => {
  it('returns null when nothing stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getServerUrl()).toBeNull();
  });

  it('stores and retrieves url', async () => {
    mockSecureStore.setItemAsync.mockResolvedValue();
    mockSecureStore.getItemAsync.mockResolvedValue('http://192.168.1.5:3000');
    await setServerUrl('http://192.168.1.5:3000');
    expect(await getServerUrl()).toBe('http://192.168.1.5:3000');
  });
});

describe('savedHosts', () => {
  it('returns empty array when none saved', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    expect(await getSavedHosts()).toEqual([]);
  });

  it('adds host and deduplicates', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(['http://a:3000']));
    mockSecureStore.setItemAsync.mockResolvedValue();
    await addSavedHost('http://b:3000');
    const saved = JSON.parse(mockSecureStore.setItemAsync.mock.calls[0][1] as string) as string[];
    expect(saved[0]).toBe('http://b:3000');
    expect(saved).toContain('http://a:3000');
  });

  it('caps saved hosts at 3', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(JSON.stringify(['http://a:3000', 'http://b:3000', 'http://c:3000']));
    mockSecureStore.setItemAsync.mockResolvedValue();
    await addSavedHost('http://d:3000');
    const saved = JSON.parse(mockSecureStore.setItemAsync.mock.calls[0][1] as string) as string[];
    expect(saved).toHaveLength(3);
    expect(saved[0]).toBe('http://d:3000');
  });
});
