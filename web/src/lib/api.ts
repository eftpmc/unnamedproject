import { getToken, setToken, clearToken } from './auth.js';
import type { Session, Message, Project, ProjectArtifact, Connection, EffortLevel, ClaudeModelInfo, UserSettings, AgentBudgets, Memory, ScheduledTask, SessionWorktree, Campaign, CampaignTask, Pipeline, PipelineTask, PermissionProfile, SessionEvent, SessionProjectLink } from '../types.js';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
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

export function getChatEvents(chatId: string): Promise<{ events: SessionEvent[]; projects: SessionProjectLink[] }> {
  return request(`/sessions/${chatId}/events`);
}

export function truncateMessagesFrom(sessionId: string, messageId: string): Promise<{ deleted: number }> {
  return request(`/sessions/${sessionId}/messages/from/${messageId}`, { method: 'DELETE' });
}

export function createChat(title?: string): Promise<{ id: string }> {
  return request('/sessions', { method: 'POST', body: JSON.stringify({ title }) });
}

export function updateChatConfig(chatId: string, config: { effort?: EffortLevel; model?: string | null; pinned_project_id?: string | null }): Promise<void> {
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

export function getMe(): Promise<{ email: string }> {
  return request('/auth/me');
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

export function cancelExecution(executionId: string): Promise<void> {
  return request(`/executions/${executionId}/cancel`, { method: 'POST' });
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

export function getProjectTree(projectId: string, dirPath?: string): Promise<{ entries: { name: string; type: 'file' | 'dir'; path: string }[]; base_is_repo: boolean }> {
  const q = dirPath ? `?path=${encodeURIComponent(dirPath)}` : '';
  return request(`/projects/${projectId}/tree${q}`);
}

export function getProjectFile(projectId: string, filePath: string): Promise<{ content: string; path: string }> {
  return request(`/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
}

export function getSettings(): Promise<UserSettings> {
  return request('/settings');
}

export function updateSettings(body: { projects_root: string; permission_profile?: PermissionProfile }): Promise<UserSettings> {
  return request('/settings', { method: 'PUT', body: JSON.stringify(body) });
}

export function updateAgentBudgets(body: { claude_code?: number | null; codex?: number | null }): Promise<{ agent_budgets: AgentBudgets; permission_profile: PermissionProfile }> {
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

export function getProjectCampaigns(projectId: string): Promise<Campaign[]> {
  return request(`/projects/${projectId}/campaigns`);
}

export function getAllCampaigns(): Promise<{ campaigns: (Campaign & { project_name: string })[] }> {
  return request('/campaigns');
}

export function getCampaign(campaignId: string): Promise<{ campaign: Campaign; tasks: CampaignTask[] }> {
  return request(`/campaigns/${campaignId}`);
}

export function cancelCampaign(campaignId: string): Promise<{ campaign: Campaign }> {
  return request(`/campaigns/${campaignId}/cancel`, { method: 'POST' });
}

export function resumeCampaign(campaignId: string): Promise<{ campaign: Campaign; tasks: CampaignTask[] }> {
  return request(`/campaigns/${campaignId}/resume`, { method: 'POST' });
}

export function getPipelines(): Promise<{ pipelines: Pipeline[] }> {
  return request('/pipelines');
}

export function getPipeline(id: string): Promise<{ pipeline: Pipeline; tasks: PipelineTask[] }> {
  return request(`/pipelines/${id}`);
}

export function deletePipeline(id: string): Promise<void> {
  return request(`/pipelines/${id}`, { method: 'DELETE' });
}

export function runPipeline(
  id: string,
  projectId: string,
  opts?: { title?: string; on_error?: 'stop' | 'continue' }
): Promise<{ campaign_id: string; project_id: string }> {
  return request(`/pipelines/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, ...opts }),
  });
}

export function updateProject(projectId: string, body: { description?: string }): Promise<void> {
  return request(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export interface ProjectCapabilities {
  has_remotion: boolean;
  has_media: boolean;
  has_graph: boolean;
  has_research: boolean;
}

export function getProjectCapabilities(projectId: string): Promise<ProjectCapabilities> {
  return request(`/projects/${projectId}/capabilities`);
}

export function getProjectArtifacts(projectId: string): Promise<{ artifacts: ProjectArtifact[] }> {
  return request(`/projects/${projectId}/artifacts`);
}

export async function getArtifactContent(contentUrl: string): Promise<string> {
  const token = getToken();
  const res = await fetch(contentUrl, {
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
  return res.text();
}
