import * as SecureStore from 'expo-secure-store';

const KEYS = {
  TOKEN: 'auth_token',
  SERVER_URL: 'server_url',
  SAVED_HOSTS: 'saved_hosts',
} as const;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.TOKEN);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TOKEN, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.TOKEN);
}

export async function getServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.SERVER_URL);
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.SERVER_URL, url);
}

export async function getSavedHosts(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(KEYS.SAVED_HOSTS);
  if (!raw) return [];
  try { return JSON.parse(raw) as string[]; } catch { return []; }
}

export async function addSavedHost(url: string): Promise<void> {
  const existing = await getSavedHosts();
  const deduped = [url, ...existing.filter(h => h !== url)].slice(0, 3);
  await SecureStore.setItemAsync(KEYS.SAVED_HOSTS, JSON.stringify(deduped));
}
