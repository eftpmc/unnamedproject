import { useAppStore } from './store';

class AuthError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'AuthError';
  }
}

function toPlainHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const obj: Record<string, string> = {};
    h.forEach((v, k) => { obj[k] = v; });
    return obj;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return h as Record<string, string>;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { serverUrl, token, signOut } = useAppStore.getState();
  if (!serverUrl) throw new Error('No server URL configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...toPlainHeaders(init.headers),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}${path}`, { ...init, headers });

  if (res.status === 401) {
    signOut();
    throw new AuthError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as unknown as T;
  }
  return res.json() as Promise<T>;
}

/** Multipart upload for messages with attachments */
export async function uploadMessage(
  sessionId: string,
  content: string,
  attachments: Array<{ uri: string; name: string; type: string }>
): Promise<unknown> {
  const { serverUrl, token, signOut } = useAppStore.getState();
  if (!serverUrl) throw new Error('No server URL configured');

  const form = new FormData();
  form.append('content', content);
  for (const att of attachments) {
    form.append('attachments', { uri: att.uri, name: att.name, type: att.type } as unknown as Blob);
  }

  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) { signOut(); throw new AuthError(); }
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status}: ${t}`); }
  return res.json();
}
