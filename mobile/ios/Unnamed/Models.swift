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

  enum CodingKeys: String, CodingKey {
    case id
    case role
    case content
    case createdAt = "created_at"
    case attachments
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
  let command: String?
  let cmd: String?
  let description: String?
  let cwd: String?
  let prompt: String?
  let op: String?
  let branch: String?
  let remote: String?

  var summary: String? { command ?? cmd ?? path ?? filePath ?? prompt ?? description }

  var displayPairs: [(label: String, value: String)] {
    var pairs: [(String, String)] = []
    if let v = command ?? cmd   { pairs.append(("Command", v)) }
    if let v = path ?? filePath { pairs.append(("Path", v)) }
    if let v = cwd              { pairs.append(("Directory", v)) }
    if let v = prompt           { pairs.append(("Prompt", v)) }
    if let v = op               { pairs.append(("Operation", v)) }
    if let v = branch           { pairs.append(("Branch", v)) }
    if let v = remote           { pairs.append(("Remote", v)) }
    if let v = description      { pairs.append(("Description", v)) }
    return pairs
  }

  enum CodingKeys: String, CodingKey {
    case path, command, cmd, description, cwd, prompt, op, branch, remote
    case filePath = "file_path"
  }
}

struct ToolEvent {
  let executionId: String
  let tool: String
  var status: String
  var output: String = ""
  var result: String?
}

struct ApprovalDecision: Decodable { let status: String }
struct OKResponse: Decodable { let ok: Bool }
struct ActiveSessionsResult: Decodable { let ids: [String] }
struct PinSessionRequest: Encodable {
  let pinnedProjectId: String?
  enum CodingKeys: String, CodingKey { case pinnedProjectId = "pinned_project_id" }
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
