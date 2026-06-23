import Foundation

enum APIError: LocalizedError {
  case missingServer
  case invalidURL
  case unauthorized
  case server(status: Int, message: String)
  case emptyResponse

  var errorDescription: String? {
    switch self {
    case .missingServer:
      return "No server is configured."
    case .invalidURL:
      return "The server address is not valid."
    case .unauthorized:
      return "Sign in is required."
    case .server(let status, let message):
      return message.isEmpty ? "Server returned \(status)." : message
    case .emptyResponse:
      return "The server returned an empty response."
    }
  }
}

final class APIClient {
  private let session: AppSession
  private let urlSession: URLSession

  init(session: AppSession = .shared, urlSession: URLSession = .shared) {
    self.session = session
    self.urlSession = urlSession
  }

  func me() async throws -> UserProfile {
    try await request(path: "/auth/me")
  }

  func login(email: String, password: String) async throws -> LoginResponse {
    try await request(path: "/auth/login", method: "POST", body: LoginRequest(email: email, password: password), authorize: false)
  }

  func sessions() async throws -> [ChatSession] {
    try await request(path: "/sessions")
  }

  func createSession(title: String? = nil, model: String? = nil, effort: String? = nil) async throws -> CreateSessionResponse {
    try await request(path: "/sessions", method: "POST", body: CreateSessionRequest(title: title, model: model, effort: effort))
  }

  func modelsForEffort(_ effort: String) async throws -> [ClaudeModelInfo] {
    try await request(path: "/sessions/models?effort=\(effort)")
  }

  @discardableResult
  func updateSessionConfig(id: String, effort: String? = nil, model: String?? = nil, title: String? = nil) async throws -> OKResponse {
    var body = UpdateSessionConfigRequest(effort: effort, title: title)
    if let model {
      body.model = model
      body.modelIncluded = true
    }
    return try await request(path: "/sessions/\(id)", method: "PATCH", body: body)
  }

  func messages(sessionId: String) async throws -> [ChatMessage] {
    try await request(path: "/sessions/\(sessionId)/messages")
  }

  func sendMessage(sessionId: String, content: String, attachments: [PendingAttachment] = []) async throws -> ChatMessage {
    guard !attachments.isEmpty else {
      return try await request(path: "/sessions/\(sessionId)/messages", method: "POST", body: SendMessageRequest(content: content))
    }
    return try await uploadMultipart(path: "/sessions/\(sessionId)/messages", content: content, attachments: attachments)
  }

  /// Mirrors the web app's multipart POST (content + repeated `attachments`
  /// fields) since the server expects the message and its files in one
  /// request rather than a separate upload step.
  private func uploadMultipart<Response: Decodable>(path: String, content: String, attachments: [PendingAttachment]) async throws -> Response {
    guard let baseURL = session.serverURL else { throw APIError.missingServer }
    guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw APIError.invalidURL }

    let boundary = "Boundary-\(UUID().uuidString)"
    var body = Data()
    func appendField(name: String, value: String) {
      body.append("--\(boundary)\r\n".data(using: .utf8)!)
      body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
      body.append("\(value)\r\n".data(using: .utf8)!)
    }
    appendField(name: "content", value: content)
    for attachment in attachments {
      body.append("--\(boundary)\r\n".data(using: .utf8)!)
      body.append("Content-Disposition: form-data; name=\"attachments\"; filename=\"\(attachment.filename)\"\r\n".data(using: .utf8)!)
      body.append("Content-Type: \(attachment.mimeType)\r\n\r\n".data(using: .utf8)!)
      body.append(attachment.data)
      body.append("\r\n".data(using: .utf8)!)
    }
    body.append("--\(boundary)--\r\n".data(using: .utf8)!)

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.timeoutInterval = 60
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    if let token = session.token {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    request.httpBody = body

    let (data, response) = try await urlSession.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError.emptyResponse }
    if http.statusCode == 401 { throw APIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      let error = try? JSONDecoder().decode(ServerError.self, from: data)
      throw APIError.server(status: http.statusCode, message: error?.error ?? String(data: data, encoding: .utf8) ?? "")
    }
    guard !data.isEmpty else { throw APIError.emptyResponse }
    return try JSONDecoder().decode(Response.self, from: data)
  }

  func pendingApprovals() async throws -> [PendingApproval] {
    try await request(path: "/executions/pending-approvals")
  }

  @discardableResult
  func approveExecution(id: String) async throws -> ApprovalDecision {
    try await request(path: "/executions/\(id)/approve", method: "POST")
  }

  @discardableResult
  func rejectExecution(id: String) async throws -> ApprovalDecision {
    try await request(path: "/executions/\(id)/reject", method: "POST")
  }

  func activeSessions() async throws -> [String] {
    let result: ActiveSessionsResult = try await request(path: "/sessions/active")
    return result.ids
  }

  @discardableResult
  func deleteSession(id: String) async throws -> OKResponse {
    try await request(path: "/sessions/\(id)", method: "DELETE")
  }

  @discardableResult
  func pinSessionToProject(sessionId: String, projectId: String) async throws -> OKResponse {
    try await request(path: "/sessions/\(sessionId)", method: "PATCH", body: PinSessionRequest(pinnedProjectId: projectId))
  }

  func projects() async throws -> [Project] {
    try await request(path: "/projects")
  }

  func registerApnsToken(_ hex: String) async throws {
    struct Body: Encodable { let apnsDeviceToken: String }
    _ = try await request(path: "/settings", method: "PUT", body: Body(apnsDeviceToken: hex)) as OKResponse
  }

  func projectPlans(projectId: String) async throws -> [Plan] {
    try await request(path: "/projects/\(projectId)/plans")
  }

  func projectTree(projectId: String, dirPath: String? = nil) async throws -> ProjectTreeResult {
    if let p = dirPath {
      let encoded = p.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? p
      return try await request(path: "/projects/\(projectId)/tree?path=\(encoded)")
    }
    return try await request(path: "/projects/\(projectId)/tree")
  }

  func projectFile(projectId: String, filePath: String) async throws -> ProjectFileResult {
    let encoded = filePath.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? filePath
    return try await request(path: "/projects/\(projectId)/file?path=\(encoded)")
  }

  @discardableResult
  func checkServer(_ url: URL) async throws -> UserProfile {
    let original = session.serverURL
    session.setServerURL(url)
    do {
      return try await me()
    } catch {
      if let original {
        session.setServerURL(original)
      }
      throw error
    }
  }

  private func request<Response: Decodable>(
    path: String,
    method: String = "GET",
    body: Encodable? = nil,
    authorize: Bool = true
  ) async throws -> Response {
    guard let baseURL = session.serverURL else { throw APIError.missingServer }
    guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw APIError.invalidURL }

    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
    }

    if authorize, let token = session.token {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    let (data, response) = try await urlSession.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError.emptyResponse }

    if http.statusCode == 401 { throw APIError.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      let error = try? JSONDecoder().decode(ServerError.self, from: data)
      throw APIError.server(status: http.statusCode, message: error?.error ?? String(data: data, encoding: .utf8) ?? "")
    }
    guard !data.isEmpty else { throw APIError.emptyResponse }
    return try JSONDecoder().decode(Response.self, from: data)
  }
}

private struct AnyEncodable: Encodable {
  private let encodeValue: (Encoder) throws -> Void

  init(_ value: Encodable) {
    self.encodeValue = value.encode
  }

  func encode(to encoder: Encoder) throws {
    try encodeValue(encoder)
  }
}
