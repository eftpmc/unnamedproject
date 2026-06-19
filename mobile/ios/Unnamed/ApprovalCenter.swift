import UIKit
import UserNotifications

extension Notification.Name {
  static let approvalCountChanged = Notification.Name("ApprovalCountChanged")
}

/// App-lifetime owner of the pending-approval count, the app icon badge,
/// and local approval notifications. Survives screen changes (unlike the
/// old DashboardViewController, which previously owned this).
final class ApprovalCenter {
  static let shared = ApprovalCenter()

  private(set) var count = 0 {
    didSet {
      guard count != oldValue else { return }
      updateAppBadge()
      NotificationCenter.default.post(name: .approvalCountChanged, object: nil)
    }
  }

  private var lastNotifiedCount = 0
  private var wsSubscriptionId: UUID?
  private var started = false

  private init() {}

  func start() {
    guard !started else { return }
    started = true
    UNUserNotificationCenter.current().requestAuthorization(options: [.badge, .sound, .alert]) { _, _ in }
    NotificationCenter.default.addObserver(self, selector: #selector(handleBadgeCleared), name: .approvalBadgeCleared, object: nil)
    wsSubscriptionId = WebSocketService.shared.subscribe { [weak self] event in
      guard let self else { return }
      if case .approvalRequested = event {
        self.lastNotifiedCount = self.count
        self.count += 1
        self.scheduleNotification(count: self.count)
      }
    }
  }

  func setCount(_ n: Int) {
    lastNotifiedCount = n
    count = n
  }

  func clear() {
    lastNotifiedCount = 0
    count = 0
  }

  @objc private func handleBadgeCleared() { clear() }

  private func updateAppBadge() {
    let n = count
    if #available(iOS 16.0, *) {
      Task { try? await UNUserNotificationCenter.current().setBadgeCount(n) }
    } else {
      UIApplication.shared.applicationIconBadgeNumber = n
    }
  }

  private func scheduleNotification(count: Int) {
    guard count > lastNotifiedCount else { return }
    let content = UNMutableNotificationContent()
    content.title = count == 1 ? "1 Pending Approval" : "\(count) Pending Approvals"
    content.body = "An agent is waiting for your response."
    content.sound = .default
    content.badge = NSNumber(value: count)
    content.categoryIdentifier = "APPROVALS"
    let request = UNNotificationRequest(
      identifier: "approvals-\(count)",
      content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
    )
    UNUserNotificationCenter.current().add(request)
  }
}
