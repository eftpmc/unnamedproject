import { useAppStore } from './store';

class AuthError extends Error {
  constructor() { super('Unauthorized'); }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const { serverUrl, token, signOut } = useAppStore.getState();
  if (!serverUrl) throw new Error('No server URL configured');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${serverUrl}${path}`, { ...init, headers });

  if (res.status === 401) {
    signOut();
    throw new AuthError();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
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

  const res = await fetch(`${serverUrl}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) { signOut(); throw new Error('Unauthorized'); }
  if (!res.ok) { const t = await res.text(); throw new Error(`${res.status}: ${t}`); }
  return res.json();
}
