import { getToken, setToken, clearToken } from './auth.js';
import type { Session, Message, Connection, AgentProvider, GoogleAccount, EffortLevel, UserSettings, Memory, ScheduledTask, SessionWorktree, PermissionProfile, SessionEvent, Document, DocumentWithBody, Project, Trigger, FileEntry, MediaItem } from '../types.js';

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
  turn: {
    id: string;
    userMessageId: string;
    startedAt: number;
    invocationMode?: string | null;
    providerType?: string | null;
    providerSessionId?: string | null;
  } | null;
  execution: { id: string; status: 'running' | 'awaiting_approval'; tool: string; createdAt: number } | null;
}

export function getChatStatus(chatId: string): Promise<ChatStatus> {
  return request(`/sessions/${chatId}/status`);
}

export interface ChatUsageRisk {
  messageCount: number;
  attributedCostUsd: number;
  providerType: string | null;
  hasProviderSession: boolean;
  shouldWarn: boolean;
}

export function getChatUsageRisk(chatId: string): Promise<ChatUsageRisk> {
  return request(`/sessions/${chatId}/usage-risk`);
}

export function stopChat(chatId: string): Promise<{ ok: boolean; stopped: boolean }> {
  return request(`/sessions/${chatId}/stop`, { method: 'POST' });
}

export function resetChatProviderSession(chatId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${chatId}/reset-provider-session`, { method: 'POST' });
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

export function updateChatConfig(chatId: string, config: { effort?: EffortLevel; pinned_project_id?: string | null; title?: string }): Promise<void> {
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

export function getMedia(): Promise<MediaItem[]> {
  return request('/media');
}

export function deleteMedia(id: string): Promise<void> {
  return request(`/media/${id}`, { method: 'DELETE' });
}

export function getPendingApprovals(): Promise<Array<{ approval_id: string; execution_id: string; action: string; payload: Record<string, unknown>; tool: string; created_at: number; session_id: string | null }>> {
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

// Documents
export function getDocuments(projectId: string, params?: { type?: string }): Promise<Document[]> {
  const q = params?.type ? `?type=${encodeURIComponent(params.type)}` : '';
  return request(`/projects/${projectId}/documents${q}`);
}

export function createGlobalDocument(body: { title: string; project_id: string }): Promise<Document> {
  return request('/documents', { method: 'POST', body: JSON.stringify(body) });
}

export function getAllDocuments(params?: { type?: string }): Promise<Document[]> {
  const q = params?.type ? `?type=${encodeURIComponent(params.type)}` : '';
  return request(`/documents${q}`);
}

export function getDocumentById(id: string): Promise<DocumentWithBody> {
  return request(`/documents/${id}`);
}

export function updateDocumentById(id: string, body: { title?: string; body?: string; frontmatter?: Record<string, unknown> }): Promise<Document> {
  return request(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteDocumentById(id: string): Promise<void> {
  return request(`/documents/${id}`, { method: 'DELETE' });
}

// Projects
export function getProjects(): Promise<Project[]> {
  return request('/projects');
}

export function getProject(id: string): Promise<Project> {
  return request(`/projects/${id}`);
}

export function createTopLevelProject(body: { name: string; repo_path?: string; default_branch?: string | null }): Promise<Project> {
  return request('/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function updateProject(id: string, body: { name?: string; default_branch?: string | null; description?: string | null; enabled_connection_ids?: string[] }): Promise<Project> {
  return request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteTopLevelProject(id: string): Promise<void> {
  return request(`/projects/${id}`, { method: 'DELETE' });
}

export function getProjectTreeByProjectId(projectId: string, dirPath?: string): Promise<{ entries: FileEntry[] }> {
  const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return request(`/projects/${projectId}/tree${q}`);
}

export function getProjectFile(id: string, filePath: string): Promise<{ content: string; path: string }> {
  return request(`/projects/${id}/file?path=${encodeURIComponent(filePath)}`);
}

export function getAllTriggers(): Promise<Trigger[]> {
  return request('/triggers');
}

export function createGlobalTrigger(body: { kind: Trigger['kind']; schedule_cron?: string; playbook_id?: string; project_id?: string }): Promise<Trigger> {
  return request('/triggers', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteGlobalTrigger(id: string): Promise<void> {
  return request(`/triggers/${id}`, { method: 'DELETE' });
}

export function updateGlobalTrigger(id: string, body: { enabled?: boolean; playbook_id?: string | null }): Promise<Trigger> {
  return request(`/triggers/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function runTriggerNow(id: string): Promise<{ status: string; sessionId: string }> {
  return request(`/triggers/${id}/fire`, { method: 'POST' });
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

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'DELETE' });
}

export function runScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}/run`, { method: 'POST' });
}

export function getGoogleStatus(): Promise<Record<string, GoogleAccount[]>> {
  return request('/auth/google/status');
}

export function getChromeStatus(): Promise<{ enabled: boolean; extensionConnected: boolean }> {
  return request('/connections/chrome/status');
}

export function enableChrome(): Promise<{ id: string }> {
  return request('/connections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Chrome Browser', type: 'chrome', purpose: 'chrome', config: {} }),
  });
}

export function disableChrome(id: string): Promise<void> {
  return request(`/connections/${id}`, { method: 'DELETE' });
}

export function getGoogleAuthUrl(service: string, label?: string): Promise<{ url: string }> {
  const params = new URLSearchParams({ service });
  if (label) params.set('label', label);
  return request(`/auth/google/url?${params}`);
}

export function disconnectGoogle(id: string): Promise<void> {
  return request(`/auth/google/${id}`, { method: 'DELETE' });
}

export function getAgentProviders(): Promise<AgentProvider[]> {
  return request('/agent-providers');
}

export function createAgentProvider(body: { name: string; type: string; config: Record<string, unknown> }): Promise<{ id: string; name: string; type: string }> {
  return request('/agent-providers', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteAgentProvider(id: string): Promise<void> {
  return request(`/agent-providers/${id}`, { method: 'DELETE' });
}

export function testAgentProvider(id: string): Promise<{ ok: boolean | null; latencyMs?: number; error?: string }> {
  return request(`/agent-providers/${id}/test`);
}

export interface VaultEntry { key: string; updated_at: number }

export function getVaultEntries(): Promise<VaultEntry[]> {
  return request('/vault');
}

export function setVaultEntry(key: string, value: string): Promise<{ key: string }> {
  return request('/vault', { method: 'POST', body: JSON.stringify({ key, value }) });
}

export function deleteVaultEntry(key: string): Promise<void> {
  return request(`/vault/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export function importVaultEntries(entries: { key: string; value: string }[]): Promise<{ imported: number }> {
  return request('/vault/import', { method: 'POST', body: JSON.stringify({ entries }) });
}
