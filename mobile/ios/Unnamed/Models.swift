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
}

struct CreateSessionResponse: Decodable {
  let id: String
}

struct SendMessageRequest: Encodable {
  let content: String
}

struct ChatMessage: Decodable {
  let id: String
  let role: String
  let content: String
  let createdAt: Int?

  enum CodingKeys: String, CodingKey {
    case id
    case role
    case content
    case createdAt = "created_at"
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
