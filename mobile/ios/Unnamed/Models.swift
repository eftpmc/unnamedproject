import Foundation

struct UserProfile: Decodable {
  let email: String
}

struct LoginRequest: Encodable {
  let email: String
  let password: String
}

struct LoginResponse: Decodable {
  let token: String
}

struct CreateSessionRequest: Encodable {
  let title: String?
  let model: String?
  let effort: String?
}

struct CreateSessionResponse: Decodable {
  let id: String
}

struct SendMessageRequest: Encodable {
  let content: String
}

struct MessageAttachment: Decodable {
  let id: String
  let filename: String
  let mimeType: String
  let sizeBytes: Int
  /// Relative API path; fetching bytes requires the same Bearer auth header
  /// as any other request (no public/anonymous URL).
  let url: String
  let createdAt: Int

  enum CodingKeys: String, CodingKey {
    case id
    case filename
    case mimeType = "mimeType"
    case sizeBytes = "sizeBytes"
    case url
    case createdAt = "createdAt"
  }
}

/// A file picked locally, not yet uploaded — built fresh for each send and
/// discarded once the multipart request completes.
struct PendingAttachment {
  let filename: String
  let mimeType: String
  let data: Data
}

struct ChatMessage: Decodable {
  let id: String
  let role: String
  let content: String
  let createdAt: Int?
  let attachments: [MessageAttachment]?
  let executions: [MessageExecution]?

  enum CodingKeys: String, CodingKey {
    case id
    case role
    case content
    case createdAt = "created_at"
    case attachments
    case executions
  }
}

struct MessageExecution: Decodable {
  let executionId: String
  let tool: String
  let projectName: String?
  let status: String
  let outputLog: String
  let result: String?
  let createdAt: Int
  let needsApproval: Bool
  let approvalId: String?
  let action: String?
  let payload: ApprovalPayload?

  enum CodingKeys: String, CodingKey {
    case executionId, tool, projectName, status, outputLog, result, createdAt, needsApproval, approvalId, action, payload
  }
}

struct ServerError: Decodable {
  let error: String
}

struct ChatSession: Decodable {
  let id: String
  let title: String?
  let effort: String?
  let model: String?
  let pinnedProjectId: String?
  let createdAt: Int?
  let updatedAt: Int?

  enum CodingKeys: String, CodingKey {
    case id
    case title
    case effort
    case model
    case pinnedProjectId = "pinned_project_id"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}

struct ClaudeModelInfo: Decodable {
  let id: String
  let displayName: String
  let supportsEffort: Bool

  enum CodingKeys: String, CodingKey {
    case id
    case displayName = "display_name"
    case supportsEffort = "supports_effort"
  }
}

/// PATCH /sessions/:id body. Only fields explicitly set are encoded — `model`
/// is a tri-state (omit vs. send `null` for Auto), so it tracks separately
/// from whether a new value was provided.
struct UpdateSessionConfigRequest: Encodable {
  var effort: String?
  var model: String?
  var modelIncluded = false
  var title: String?

  enum CodingKeys: String, CodingKey { case effort, model, title }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    if let effort { try container.encode(effort, forKey: .effort) }
    if modelIncluded { try container.encode(model, forKey: .model) }
    if let title { try container.encode(title, forKey: .title) }
  }
}

struct PendingApproval: Decodable {
  let approvalId: String
  let executionId: String
  let action: String
  let payload: ApprovalPayload?

  enum CodingKeys: String, CodingKey {
    case approvalId = "approval_id"
    case executionId = "execution_id"
    case action
    case payload
  }
}

struct ApprovalPayload: Decodable {
  let path: String?
  let filePath: String?
  let filename: String?
  let target: String?
  let command: String?
  let cmd: String?
  let script: String?
  let description: String?
  let cwd: String?
  let prompt: String?
  let url: String?
  let repo: String?
  let query: String?
  let op: String?
  let branch: String?
  let remote: String?

  var summary: String? {
    [path, filePath, filename, target, command, cmd, script, url, repo, query, prompt, description]
      .compactMap { $0 }
      .first
  }

  var displayPairs: [(label: String, value: String)] {
    var pairs: [(String, String)] = []
    if let v = path ?? filePath ?? filename ?? target { pairs.append(("Path", v)) }
    if let v = command ?? cmd ?? script { pairs.append(("Command", v)) }
    if let v = url              { pairs.append(("URL", v)) }
    if let v = repo             { pairs.append(("Repo", v)) }
    if let v = query            { pairs.append(("Query", v)) }
    if let v = cwd              { pairs.append(("Directory", v)) }
    if let v = prompt           { pairs.append(("Prompt", v)) }
    if let v = op               { pairs.append(("Operation", v)) }
    if let v = branch           { pairs.append(("Branch", v)) }
    if let v = remote           { pairs.append(("Remote", v)) }
    if let v = description      { pairs.append(("Description", v)) }
    return pairs
  }

  enum CodingKeys: String, CodingKey {
    case path, filename, target, command, cmd, script, description, cwd, prompt, url, repo, query, op, branch, remote
    case filePath = "file_path"
  }
}

struct ToolEvent {
  let executionId: String
  let tool: String
  let projectName: String?
  var status: String
  var output: String = ""
  var result: String?
  var createdAt: Int = Int(Date().timeIntervalSince1970)
  var action: String?
  var payload: ApprovalPayload?
}

struct SessionEvent: Decodable {
  let id: String
  let sessionId: String
  let type: String
  let title: String
  let body: String?
  let projectId: String?
  let planId: String?
  let artifactId: String?
  let executionId: String?
  let createdAt: Int

  enum CodingKeys: String, CodingKey {
    case id, type, title, body
    case sessionId = "session_id"
    case projectId = "project_id"
    case planId = "plan_id"
    case artifactId = "artifact_id"
    case executionId = "execution_id"
    case createdAt = "created_at"
  }
}

struct SessionEventsResult: Decodable {
  let events: [SessionEvent]
  let projects: [SessionProjectLink]
}

struct SessionProjectLink: Decodable {
  let id: String
  let name: String
  let description: String?
  let repoPath: String?
  let enabledConnectionIds: [String]
  let source: String
  let linkedAt: Int

  enum CodingKeys: String, CodingKey {
    case id, name, description, source
    case repoPath = "repo_path"
    case enabledConnectionIds = "enabled_connection_ids"
    case linkedAt = "linked_at"
  }
}

struct ChatStatus: Decodable {
  let active: Bool
  let turn: ActiveTurn?
  let execution: ActiveExecution?
}

struct ActiveTurn: Decodable {
  let id: String
  let userMessageId: String
  let startedAt: Int
}

struct ActiveExecution: Decodable {
  let id: String
  let status: String
  let tool: String
  let createdAt: Int
}

struct ApprovalDecision: Decodable { let status: String }
struct OKResponse: Decodable { let ok: Bool }
struct ActiveSessionsResult: Decodable { let ids: [String] }
struct PinSessionRequest: Encodable {
  let pinnedProjectId: String?
  enum CodingKeys: String, CodingKey { case pinnedProjectId = "pinned_project_id" }
}

struct Plan: Decodable {
  let id: String
  let projectId: String
  let sessionId: String?
  let title: String
  let status: String
  let createdAt: TimeInterval
  let completedAt: TimeInterval?
  enum CodingKeys: String, CodingKey {
    case id, title, status
    case projectId = "project_id"
    case sessionId = "session_id"
    case createdAt = "created_at"
    case completedAt = "completed_at"
  }
}

struct PlanStep: Decodable {
  let id: String
  let planId: String
  let title: String
  let agent: String
  let status: String
  let position: Int
  enum CodingKeys: String, CodingKey {
    case id, title, agent, status, position
    case planId = "plan_id"
  }
}

struct PlanDetailResult: Decodable {
  let plan: Plan
  let steps: [PlanStep]
}

struct SessionWorktree: Decodable {
  let branch: String
  let projectName: String
  let filesChanged: Int
  let ahead: Int
  let hasUncommitted: Bool

  enum CodingKeys: String, CodingKey {
    case branch, ahead
    case projectName = "project_name"
    case filesChanged = "files_changed"
    case hasUncommitted = "has_uncommitted"
  }
}

struct WorktreeDiffResult: Decodable {
  let diff: String
}

struct FileEntry: Decodable {
  let name: String
  let type: String
  let path: String
  var isDir: Bool { type == "dir" }
}

struct ProjectTreeResult: Decodable {
  let entries: [FileEntry]
  let baseIsRepo: Bool
  enum CodingKeys: String, CodingKey {
    case entries
    case baseIsRepo = "base_is_repo"
  }
}

struct ProjectFileResult: Decodable {
  let content: String
  let path: String
}

struct Project: Decodable {
  let id: String
  let name: String
  let description: String?
  let repoPath: String?
  let enabledConnectionIds: [String]
  let createdAt: Int?

  enum CodingKeys: String, CodingKey {
    case id
    case name
    case description
    case repoPath = "repo_path"
    case enabledConnectionIds = "enabled_connection_ids"
    case createdAt = "created_at"
  }
}

struct ProjectArtifactsResult: Decodable {
  let artifacts: [ProjectArtifact]
}

struct ProjectArtifact: Decodable {
  let id: String
  let projectId: String
  let kind: String
  let title: String
  let description: String?
  let status: String
  let mimeType: String
  let path: String?
  let url: String?
  let contentUrl: String?
  let sourcePlanId: String?
  let sourceStepId: String?
  let createdAt: Int

  enum CodingKeys: String, CodingKey {
    case id, kind, title, description, status, path, url
    case projectId = "project_id"
    case mimeType = "mime_type"
    case contentUrl = "content_url"
    case sourcePlanId = "source_plan_id"
    case sourceStepId = "source_step_id"
    case createdAt = "created_at"
  }

  var isText: Bool { mimeType.hasPrefix("text/") || mimeType == "application/json" }
  var isImage: Bool { mimeType.hasPrefix("image/") }
  var isVideo: Bool { mimeType.hasPrefix("video/") }
}
