import { getToken, setToken, clearToken } from './auth.js';
import type { Session, Message, Space, SpaceItem, Connection, EffortLevel, UserSettings, Memory, ScheduledTask, SessionWorktree, PermissionProfile, SessionEvent, Block, ItemTemplate } from '../types.js';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const isFormData = init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      'Accept': 'application/json',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
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

export function getChats(opts?: { before?: number }): Promise<Session[]> {
  const params = opts?.before ? `?before=${opts.before}` : '';
  return request(`/sessions${params}`);
}

export function searchChats(q: string): Promise<Session[]> {
  return request(`/sessions/search?q=${encodeURIComponent(q)}`);
}

export function getChatEvents(chatId: string): Promise<{ events: SessionEvent[] }> {
  return request(`/sessions/${chatId}/events`);
}

export interface ChatStatus {
  active: boolean;
  turn: { id: string; userMessageId: string; startedAt: number } | null;
  execution: { id: string; status: 'running' | 'awaiting_approval'; tool: string; createdAt: number } | null;
}

export function getChatStatus(chatId: string): Promise<ChatStatus> {
  return request(`/sessions/${chatId}/status`);
}

export function stopChat(chatId: string): Promise<{ ok: boolean; stopped: boolean }> {
  return request(`/sessions/${chatId}/stop`, { method: 'POST' });
}

export function getActiveSessions(): Promise<{ ids: string[] }> {
  return request('/sessions/active');
}

export function truncateMessagesFrom(sessionId: string, messageId: string): Promise<{ deleted: number }> {
  return request(`/sessions/${sessionId}/messages/from/${messageId}`, { method: 'DELETE' });
}

export function createChat(title?: string): Promise<{ id: string }> {
  return request('/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function updateChatConfig(chatId: string, config: { effort?: EffortLevel; pinned_space_id?: string | null; pinned_project_id?: string | null; title?: string }): Promise<void> {
  return request(`/sessions/${chatId}`, { method: 'PATCH', body: JSON.stringify(config) });
}

export function deleteChat(id: string): Promise<void> {
  return request(`/sessions/${id}`, { method: 'DELETE' });
}

export function getSessionWorktree(chatId: string): Promise<SessionWorktree | null> {
  return request(`/sessions/${chatId}/worktree`);
}

export function mergeSessionBranch(chatId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${chatId}/merge`, { method: 'POST' });
}

export function getWorktreeDiff(chatId: string): Promise<{ diff: string }> {
  return request(`/sessions/${chatId}/worktree/diff`);
}

export function getMe(): Promise<{ email: string }> {
  return request('/auth/me');
}


export function getMessages(sessionId: string): Promise<Message[]> {
  return request(`/sessions/${sessionId}/messages`);
}

export function sendMessage(sessionId: string, content: string, attachments: File[] = []): Promise<Message> {
  if (attachments.length === 0) {
    return request(`/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  const body = new FormData();
  body.append('content', content);
  for (const attachment of attachments) {
    body.append('attachments', attachment);
  }
  return request(`/sessions/${sessionId}/messages`, { method: 'POST', body });
}

export function getPendingApprovals(): Promise<Array<{ approval_id: string; execution_id: string; action: string; payload: Record<string, unknown> }>> {
  return request('/executions/pending-approvals');
}

export function approveExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/approve`, { method: 'POST' });
}

export function rejectExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/reject`, { method: 'POST' });
}

export function cancelExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/cancel`, { method: 'POST' });
}

export function getSpaces(): Promise<Space[]> {
  return request('/spaces');
}

export function createSpace(body: { name: string; description?: string; enabled_connection_ids?: string[] }): Promise<{ id: string }> {
  return request('/spaces', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteSpace(id: string): Promise<void> {
  return request(`/spaces/${id}`, { method: 'DELETE' });
}

export function updateSpace(id: string, body: { description?: string; name?: string; enabled_connection_ids?: string[] }): Promise<void> {
  return request(`/spaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function getSpaceItems(spaceId: string, opts?: { before?: number }): Promise<SpaceItem[]> {
  const params = opts?.before ? `?before=${opts.before}` : '';
  return request(`/spaces/${spaceId}/items${params}`);
}

export function createSpaceItem(
  spaceId: string,
  input: { type: string; name: string; repo_path?: string; file_path?: string },
): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items`, { method: 'POST', body: JSON.stringify(input) });
}

export function listItemTemplates(): Promise<ItemTemplate[]> {
  return request('/spaces/item-templates');
}

export function createItemTemplate(input: { name: string; blocks: Block[] }): Promise<ItemTemplate> {
  return request('/spaces/item-templates', { method: 'POST', body: JSON.stringify(input) });
}

export function updateItemTemplate(
  templateId: string,
  input: { blocks: Block[]; name?: string },
): Promise<ItemTemplate> {
  return request(`/spaces/item-templates/${templateId}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteSpaceItem(spaceId: string, itemId: string): Promise<void> {
  return request(`/spaces/${spaceId}/items/${itemId}`, { method: 'DELETE' });
}

export function getSpaceItem(spaceId: string, itemId: string): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items/${itemId}`);
}

export function getItemSessions(spaceId: string, itemId: string): Promise<{ id: string; title: string | null; last_event_at: number }[]> {
  return request(`/spaces/${spaceId}/items/${itemId}/sessions`);
}

export function updateSpaceItem(
  spaceId: string,
  itemId: string,
  input: { name?: string; page_blocks?: Block[] },
): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteItemTemplate(templateId: string): Promise<void> {
  return request(`/spaces/item-templates/${templateId}`, { method: 'DELETE' });
}

export function updateItemTask(
  spaceId: string,
  itemId: string,
  taskId: string,
  done: boolean,
): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items/${itemId}/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ done }),
  });
}

export async function getItemContent(spaceId: string, itemId: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/spaces/${spaceId}/items/${itemId}/content`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export function getItemTree(spaceId: string, itemId: string, dirPath?: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; path: string }[]; base_is_repo: boolean }> {
  const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return request(`/spaces/${spaceId}/items/${itemId}/tree${q}`);
}

export function getItemFile(spaceId: string, itemId: string, filePath: string): Promise<{ content: string; path: string }> {
  return request(`/spaces/${spaceId}/items/${itemId}/file?path=${encodeURIComponent(filePath)}`);
}

export function getItemWorkspace(spaceId: string, itemId: string): Promise<{ content: string }> {
  return request(`/spaces/${spaceId}/items/${itemId}/workspace`);
}

export function updateItemWorkspace(spaceId: string, itemId: string, content: string): Promise<void> {
  return request(`/spaces/${spaceId}/items/${itemId}/workspace`, { method: 'PUT', body: JSON.stringify({ content }) });
}

export interface SpaceCapabilities {
  has_graph: boolean;
}

export function getItemCapabilities(spaceId: string, itemId: string): Promise<SpaceCapabilities> {
  return request(`/spaces/${spaceId}/items/${itemId}/capabilities`);
}

export function getSettings(): Promise<UserSettings> {
  return request('/settings');
}

export function updateSettings(body: { projects_root: string; permission_profile?: PermissionProfile }): Promise<UserSettings> {
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

export function testConnection(id: string): Promise<{ ok: boolean | null; latencyMs?: number; error?: string }> {
  return request(`/connections/${id}/test`);
}

export function getMemory(): Promise<Memory[]> {
  return request('/memory');
}

export function getScheduledTasks(): Promise<ScheduledTask[]> {
  return request('/scheduled-tasks');
}

export function createScheduledTask(body: { type: string; interval_hours: number; prompt?: string; pinned_space_id?: string }): Promise<{ id: string }> {
  return request('/scheduled-tasks', { method: 'POST', body: JSON.stringify(body) });
}

export function updateScheduledTask(id: string, body: { enabled?: boolean; interval_hours?: number; pinned_space_id?: string | null }): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'DELETE' });
}

export function runScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}/run`, { method: 'POST' });
}

export interface ItemFile {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
  url: string;
}

export function getItemFiles(spaceId: string, itemId: string): Promise<ItemFile[]> {
  return request(`/spaces/${spaceId}/items/${itemId}/files`);
}

export async function uploadItemFile(spaceId: string, itemId: string, file: File): Promise<ItemFile> {
  const body = new FormData();
  body.append('file', file);
  return request(`/spaces/${spaceId}/items/${itemId}/files`, { method: 'POST', body });
}

export function deleteItemFile(spaceId: string, itemId: string, fileId: string): Promise<void> {
  return request(`/spaces/${spaceId}/items/${itemId}/files/${fileId}`, { method: 'DELETE' });
}

