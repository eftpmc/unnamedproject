export interface Session {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export interface Execution {
  id: string;
  message_id: string;
  workspace_id: string;
  tool: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval';
  output_log: string;
  result: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  repo_path: string | null;
  enabled_connection_ids: string[];
}

export interface Connection {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'github' | 'mcp';
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
