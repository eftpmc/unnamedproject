export interface Session {
  id: string;
  title: string | null;
  effort: EffortLevel;
  pinned_space_id: string | null;
  created_at: number;
  updated_at: number;
}

export type EffortLevel = 'low' | 'medium' | 'high';

export interface MessageExecution {
  executionId: string;
  tool: string;
  spaceName?: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  outputLog: string;
  result: string | null;
  createdAt: number;
  needsApproval: boolean;
  approvalId: string | null;
  action: string | null;
  payload?: Record<string, unknown>;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  createdAt: number;
}

export interface MediaItem extends MessageAttachment {
  messageId: string;
  sessionId: string;
  sessionTitle: string | null;
}

export type SessionEventType =
  | 'scope_changed'
  | 'project_linked'
  | 'project_created'
  | 'document_created'
  | 'document_updated'
  | 'artifact_created'
  | 'approval_requested'
  | 'approval_resolved'
  | 'mcp_required';

export interface SessionEvent {
  id: string;
  session_id: string;
  type: SessionEventType;
  title: string;
  body: string | null;
  space_id: string | null;
  item_id: string | null;
  execution_id: string | null;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
  attachments?: MessageAttachment[];
  executions?: MessageExecution[];
}

export interface Execution {
  id: string;
  message_id: string;
  space_id: string;
  tool: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  output_log: string;
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Space {
  id: string;
  name: string;
  description: string | null;
  enabled_connection_ids: string[];
  created_at?: number;
}

export interface Document {
  id: string;
  space_id: string;
  path: string;
  title: string;
  type: string | null;
  status: string | null;
  frontmatter: Record<string, unknown>;
  source_session_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface DocumentWithBody extends Document {
  body: string;
}

export interface Project {
  id: string;
  space_id: string;
  name: string;
  repo_path: string;
  default_branch: string | null;
  origin: 'created' | 'linked';
  created_at: number;
}

export interface Trigger {
  id: string;
  space_id: string;
  kind: 'schedule' | 'webhook' | 'manual';
  schedule_cron: string | null;
  playbook_id: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export type PermissionProfile = 'fast' | 'trusted' | 'strict';

export interface UserSettings {
  projects_root: string;
  permission_profile: PermissionProfile;
}

export interface Connection {
  id: string;
  name: string;
  type: 'github' | 'mcp' | 'google';
  purpose: 'github' | 'mcp' | 'tool' | 'google';
  service?: string;
  created_at: number;
}

export interface AgentProvider {
  id: string;
  name: string;
  type: 'claude_code' | 'codex';
  created_at: number;
}

export interface GoogleAccount {
  id: string;
  name: string;
  email: string;
}

export interface WSEvent {
  type: string;
  [key: string]: unknown;
}

export interface WSAgentError extends WSEvent {
  type: 'agent_error';
  sessionId?: string;
  error: string;
}

export interface WSExecutionUpdate extends WSEvent {
  type: 'execution_update';
  sessionId?: string | null;
  executionId: string;
  status?: string;
  chunk?: string;
  result?: string;
  tool?: string;
  spaceName?: string;
  messageId?: string;
}

export interface WSApprovalRequested extends WSEvent {
  type: 'approval_requested';
  sessionId?: string | null;
  executionId: string;
  approvalId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface WSAutoApproved extends WSEvent {
  type: 'action_auto_approved';
  sessionId?: string | null;
  executionId: string;
  approvalId: string;
  action: string;
}

export interface WSMessageCreated extends WSEvent {
  type: 'message_created';
  sessionId: string;
  message: Message;
}

export interface WSMessageStarted extends WSEvent {
  type: 'message_started';
  sessionId: string;
  message: Message;
}

export interface WSMessageDelta extends WSEvent {
  type: 'message_delta';
  sessionId: string;
  messageId: string;
  delta: string;
}

export interface WSTurnComplete extends WSEvent {
  type: 'turn_complete';
  sessionId: string;
  status?: 'done' | 'error' | 'stopped';
  inputTokens?: number;
}

export interface WSSessionTitleUpdated extends WSEvent {
  type: 'session_title_updated';
  sessionId: string;
  title: string;
}

export interface WSSessionEventCreated extends WSEvent {
  type: 'session_event_created';
  sessionId: string;
  event: SessionEvent;
}

export interface Memory {
  type: 'user' | 'feedback' | 'project' | 'reference';
  key: string;
  value: string;
  space_id: string | null;
}

export interface SessionWorktree {
  branch: string;
  project_name: string;
  space_name?: string;
  files_changed: number;
  ahead: number;
  has_uncommitted: boolean;
}

export interface ScheduledTask {
  id: string;
  type: string;
  prompt: string | null;
  interval_hours: number;
  enabled: number;
  next_run_at: number;
  last_run_at: number | null;
  pinned_space_id: string | null;
}

export interface AgentProvider {
  id: string;
  name: string;
  type: 'claude_code' | 'codex';
  created_at: number;
}
