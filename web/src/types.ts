export interface Session {
  id: string;
  title: string | null;
  effort: EffortLevel;
  model: string | null;
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

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
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

export interface UserSettings {
  projects_root: string | null;
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

export interface WSExecutionUpdate extends WSEvent {
  type: 'execution_update';
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
  executionId: string;
  approvalId: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface WSAutoApproved extends WSEvent {
  type: 'action_auto_approved';
  executionId: string;
  approvalId: string;
  action: string;
}

export interface WSMessageCreated extends WSEvent {
  type: 'message_created';
  message: Message;
}

export interface WSMessageStarted extends WSEvent {
  type: 'message_started';
  message: Message;
}

export interface WSMessageDelta extends WSEvent {
  type: 'message_delta';
  messageId: string;
  delta: string;
}
