import { getToken, setToken, clearToken } from './auth.js';
import type { Session, Message, Project, Connection, EffortLevel, ClaudeModelInfo, UserSettings, Memory, ScheduledTask } from '../types.js';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function login(email: string, password: string): Promise<string> {
  const data = await request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data.token;
}

export function getSessions(): Promise<Session[]> {
  return request('/sessions');
}

export function createSession(title?: string): Promise<{ id: string }> {
  return request('/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function updateSessionConfig(sessionId: string, config: { effort?: EffortLevel; model?: string | null }): Promise<void> {
  return request(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(config) });
}

export function getModelsForEffort(effort: EffortLevel): Promise<ClaudeModelInfo[]> {
  return request(`/sessions/models?effort=${effort}`);
}

export function getMessages(sessionId: string): Promise<Message[]> {
  return request(`/sessions/${sessionId}/messages`);
}

export function sendMessage(sessionId: string, content: string): Promise<Message> {
  return request(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function approveExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/approve`, { method: 'POST' });
}

export function rejectExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/reject`, { method: 'POST' });
}

export function getProjects(): Promise<Project[]> {
  return request('/projects');
}

export function createProject(body: { name: string; description?: string; repo_path?: string; enabled_connection_ids: string[] }): Promise<{ id: string }> {
  return request('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function getSettings(): Promise<UserSettings> {
  return request('/settings');
}

export function updateSettings(body: { projects_root: string }): Promise<UserSettings> {
  return request('/settings', { method: 'PUT', body: JSON.stringify(body) });
}

export function getConnections(): Promise<Connection[]> {
  return request('/connections');
}

export function createConnection(body: { name: string; type: string; purpose?: string; config: Record<string, unknown> }): Promise<{ id: string }> {
  return request('/connections', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteConnection(id: string): Promise<void> {
  return request(`/connections/${id}`, { method: 'DELETE' });
}

export function getMemory(): Promise<Memory[]> {
  return request('/memory');
}

export function getScheduledTasks(): Promise<ScheduledTask[]> {
  return request('/scheduled-tasks');
}

export function updateScheduledTask(id: string, body: { enabled?: boolean; interval_hours?: number }): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function runScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}/run`, { method: 'POST' });
}
