import { getToken, setToken, clearToken } from './auth.js';
import type { Session, Message, Space, SpaceItem, SpaceItemType, Connection, EffortLevel, ClaudeModelInfo, UserSettings, AgentBudgets, Memory, ScheduledTask, SessionWorktree, Plan, PlanStep, Pipeline, PipelineTask, PermissionProfile, SessionEvent, SessionSpaceLink, Block } from '../types.js';

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

export function getChats(): Promise<Session[]> {
  return request('/sessions');
}

export function searchChats(q: string): Promise<Session[]> {
  return request(`/sessions/search?q=${encodeURIComponent(q)}`);
}

export function getChatEvents(chatId: string): Promise<{ events: SessionEvent[]; projects: SessionSpaceLink[] }> {
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

export function updateChatConfig(chatId: string, config: { effort?: EffortLevel; model?: string | null; pinned_space_id?: string | null; pinned_project_id?: string | null; title?: string }): Promise<void> {
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

export function getModelsForEffort(effort: EffortLevel): Promise<ClaudeModelInfo[]> {
  return request(`/sessions/models?effort=${effort}`);
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

export function getSpaceItems(spaceId: string): Promise<SpaceItem[]> {
  return request(`/spaces/${spaceId}/items`);
}

export function createSpaceItem(
  spaceId: string,
  input: { type: SpaceItemType; name: string; repo_path?: string; file_path?: string; content?: string; template?: string; blocks?: Block[] },
): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items`, { method: 'POST', body: JSON.stringify(input) });
}

export function deleteSpaceItem(spaceId: string, itemId: string): Promise<void> {
  return request(`/spaces/${spaceId}/items/${itemId}`, { method: 'DELETE' });
}

export function getSpaceItem(spaceId: string, itemId: string): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items/${itemId}`);
}

export function updateSpaceItem(
  spaceId: string,
  itemId: string,
  input: { name?: string; content?: string; blocks?: Block[]; overview_blocks?: Block[] | null },
): Promise<SpaceItem> {
  return request(`/spaces/${spaceId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
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
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
  has_research: boolean;
}

export function getItemCapabilities(spaceId: string, itemId: string): Promise<SpaceCapabilities> {
  return request(`/spaces/${spaceId}/items/${itemId}/capabilities`);
}

export function getSpacePlans(spaceId: string): Promise<Plan[]> {
  return request(`/spaces/${spaceId}/plans`);
}

export function getSettings(): Promise<UserSettings> {
  return request('/settings');
}

export function updateSettings(body: { projects_root: string; permission_profile?: PermissionProfile }): Promise<UserSettings> {
  return request('/settings', { method: 'PUT', body: JSON.stringify(body) });
}

export function updateAgentBudgets(body: { claude_code?: number | null; codex?: number | null; claude_code_daily?: number | null; codex_daily?: number | null }): Promise<{ agent_budgets: AgentBudgets; agent_daily_budgets: AgentBudgets; permission_profile: PermissionProfile }> {
  return request('/settings/agent-budgets', { method: 'PUT', body: JSON.stringify(body) });
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

export function updateScheduledTask(id: string, body: { enabled?: boolean; interval_hours?: number }): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}`, { method: 'DELETE' });
}

export function runScheduledTask(id: string): Promise<void> {
  return request(`/scheduled-tasks/${id}/run`, { method: 'POST' });
}

export function getAllPlans(): Promise<{ plans: (Plan & { space_name: string })[] }> {
  return request('/plans');
}

export function getPlan(planId: string): Promise<{ plan: Plan; steps: PlanStep[] }> {
  return request(`/plans/${planId}`);
}

export function cancelPlan(planId: string): Promise<{ plan: Plan }> {
  return request(`/plans/${planId}/cancel`, { method: 'POST' });
}

export function resumePlan(planId: string): Promise<{ plan: Plan; steps: PlanStep[] }> {
  return request(`/plans/${planId}/resume`, { method: 'POST' });
}

export function getSpacePipelines(spaceId: string): Promise<{ pipelines: Pipeline[] }> {
  return request(`/spaces/${spaceId}/pipelines`);
}

export function getSpacePipeline(spaceId: string, id: string): Promise<{ pipeline: Pipeline; tasks: PipelineTask[] }> {
  return request(`/spaces/${spaceId}/pipelines/${id}`);
}

export function deleteSpacePipeline(spaceId: string, id: string): Promise<void> {
  return request(`/spaces/${spaceId}/pipelines/${id}`, { method: 'DELETE' });
}

export function runSpacePipeline(
  spaceId: string,
  id: string,
  opts?: { title?: string; on_error?: 'stop' | 'continue' }
): Promise<{ plan_id: string; space_id: string }> {
  return request(`/spaces/${spaceId}/pipelines/${id}/run`, {
    method: 'POST',
    body: JSON.stringify(opts ?? {}),
  });
}
