export interface Chat {
  id: string
  title: string | null
  effort: 'low' | 'medium' | 'high'
  model: string | null
  created_at: number
  updated_at: number
}

export interface Attachment {
  id: string
  filename: string
  content_type: string
  size: number
  url: string
}

export interface Execution {
  id: string
  tool: string
  status: 'pending' | 'running' | 'done' | 'error' | 'awaiting_approval' | 'cancelled'
  input?: unknown
  output?: string
  error?: string
}

export interface Message {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
  attachments?: Attachment[]
  executions?: Execution[]
}

export interface ChatStatus {
  active: boolean
  turn?: { id: string; status: string }
  execution?: { id: string; status: string }
}

export interface PendingApproval {
  id: string
  execution_id: string
  session_id: string | null
  action: string
  payload: unknown
  created_at: number
}

export interface Project {
  id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface Campaign {
  id: string
  project_id: string
  name: string
  status: string
  created_at: number
}

export interface Artifact {
  id: string
  name: string
  type: string
  created_at: number
}

export interface Pipeline {
  id: string
  name: string
  description: string | null
  created_at: number
}

export interface WSEvent {
  type: string
  sessionId?: string
  executionId?: string
  approvalId?: string
  action?: string
  payload?: unknown
  delta?: string
  message?: Message
  [key: string]: unknown
}
