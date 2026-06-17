import Foundation

// MARK: - Event types

enum WSEvent {
  case messageStarted(sessionId: String, message: ChatMessage)
  case messageDelta(sessionId: String, messageId: String, delta: String)
  case messageCreated(sessionId: String, message: ChatMessage)
  case turnComplete(sessionId: String, status: String)
  case approvalRequested(sessionId: String?, executionId: String, approvalId: String, action: String)
}

private struct RawWSEvent: Decodable {
  let type: String
  let sessionId: String?
  let messageId: String?
  let delta: String?
  let message: ChatMessage?
  let status: String?
  let executionId: String?
  let approvalId: String?
  let action: String?

  enum CodingKeys: String, CodingKey {
    case type, sessionId, messageId, delta, message, status, action
    case executionId = "executionId"
    case approvalId = "approvalId"
  }
}

private extension WSEvent {
  init?(raw: RawWSEvent) {
    switch raw.type {
    case "message_started":
      guard let sid = raw.sessionId, let msg = raw.message else { return nil }
      self = .messageStarted(sessionId: sid, message: msg)
    case "message_delta":
      guard let sid = raw.sessionId, let mid = raw.messageId, let d = raw.delta else { return nil }
      self = .messageDelta(sessionId: sid, messageId: mid, delta: d)
    case "message_created":
      guard let sid = raw.sessionId, let msg = raw.message else { return nil }
      self = .messageCreated(sessionId: sid, message: msg)
    case "turn_complete":
      guard let sid = raw.sessionId else { return nil }
      self = .turnComplete(sessionId: sid, status: raw.status ?? "done")
    case "approval_requested":
      guard let eid = raw.executionId, let aid = raw.approvalId, let act = raw.action else { return nil }
      self = .approvalRequested(sessionId: raw.sessionId, executionId: eid, approvalId: aid, action: act)
    default:
      return nil
    }
  }
}

// MARK: - Service

final class WebSocketService {
  static let shared = WebSocketService()

  typealias Handler = (WSEvent) -> Void

  private var task: URLSessionWebSocketTask?
  private var subscribers: [UUID: Handler] = [:]
  private var reconnectDelay: TimeInterval = 1.0
  private let maxDelay: TimeInterval = 30.0
  private var stopping = false

  private init() {}

  func connect() {
    guard let url = AppSession.shared.serverURL, let token = AppSession.shared.token else { return }
    stopping = false
    reconnectDelay = 1.0
    openSocket(serverURL: url, token: token)
  }

  func disconnect() {
    stopping = true
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
  }

  @discardableResult
  func subscribe(_ handler: @escaping Handler) -> UUID {
    let id = UUID()
    subscribers[id] = handler
    return id
  }

  func unsubscribe(_ id: UUID) {
    subscribers.removeValue(forKey: id)
  }

  private func openSocket(serverURL: URL, token: String) {
    var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
    components.scheme = serverURL.scheme == "https" ? "wss" : "ws"
    components.queryItems = [URLQueryItem(name: "token", value: token)]
    guard let wsURL = components.url else { return }

    let task = URLSession.shared.webSocketTask(with: wsURL)
    self.task = task
    task.resume()
    receiveLoop()
  }

  private func receiveLoop() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let msg):
        if case .string(let text) = msg,
           let data = text.data(using: .utf8),
           let raw = try? JSONDecoder().decode(RawWSEvent.self, from: data),
           let event = WSEvent(raw: raw) {
          DispatchQueue.main.async {
            self.subscribers.values.forEach { $0(event) }
          }
        }
        self.receiveLoop()
      case .failure:
        self.scheduleReconnect()
      }
    }
  }

  private func scheduleReconnect() {
    guard !stopping else { return }
    task = nil
    let delay = reconnectDelay
    reconnectDelay = min(reconnectDelay * 2, maxDelay)
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, !self.stopping else { return }
      self.connect()
    }
  }
}
