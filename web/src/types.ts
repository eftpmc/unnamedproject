export interface Session {
  id: string;
  title: string | null;
  effort: EffortLevel;
  model: string | null;
  pinned_project_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface ClaudeModelInfo {
  id: string;
  display_name: string;
  created_at: string;
  supports_effort: boolean;
}

export type EffortLevel = 'low' | 'medium' | 'high';

export interface MessageExecution {
  executionId: string;
  tool: string;
  projectName?: string;
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

export type SessionEventType =
  | 'scope_changed'
  | 'project_linked'
  | 'project_created'
  | 'plan_created'
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
  project_id: string | null;
  plan_id: string | null;
  artifact_id: string | null;
  execution_id: string | null;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface SessionProjectLink extends Project {
  source: 'agent' | 'user' | 'system';
  linked_at: number;
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
  project_id: string;
  tool: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  output_log: string;
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
}

export interface ProjectArtifact {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  description: string | null;
  status: 'ready' | 'review' | 'running' | 'error';
  mime_type: string;
  path: string | null;
  url: string | null;
  content_url: string | null;
  metadata: Record<string, unknown>;
  source_plan_id: string | null;
  source_step_id: string | null;
  created_at: number;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  path: string;
}

export interface AgentBudgets {
  claude_code: number | null;
  codex: number | null;
}

export type PermissionProfile = 'fast' | 'trusted' | 'strict';

export interface UserSettings {
  projects_root: string;
  agent_budgets: AgentBudgets;
  agent_daily_budgets: AgentBudgets;
  permission_profile: PermissionProfile;
}

export interface Connection {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'github' | 'mcp';
  purpose: 'lead_agent' | 'claude_code' | 'codex' | 'github' | 'mcp' | 'tool';
  created_at: number;
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
  projectName?: string;
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
  project_id: string | null;
}

export interface SessionWorktree {
  branch: string;
  project_name: string;
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
}

export interface PlanStep {
  id: string;
  plan_id: string;
  title: string;
  agent: 'claude_code' | 'codex' | 'mcp' | 'file_write' | 'git' | 'github' | 'eval' | 'subagent';
  status: 'waiting' | 'running' | 'done' | 'error';
  execution_id: string | null;
  position: number;
  prompt: string | null;
  depends_on: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Plan {
  id: string;
  project_id: string;
  session_id: string | null;
  title: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  created_at: number;
  completed_at: number | null;
}

export interface Pipeline {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: number;
  task_count?: number;
  agents?: PlanStep['agent'][];
}

export interface PipelineTask {
  id: string;
  pipeline_id: string;
  title: string;
  agent: PlanStep['agent'];
  prompt: string | null;
  tool_args: string | null;
  depends_on: string | null;
  position: number;
  created_at: number;
}

export interface WSPlanStepUpdated extends WSEvent {
  type: 'plan_step_updated';
  stepId: string;
  status: PlanStep['status'];
}

export interface WSPlanUpdated extends WSEvent {
  type: 'plan_updated';
  planId: string;
  status: Plan['status'];
}
