import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var coordinator: AppCoordinator?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self

    let window = UIWindow(frame: UIScreen.main.bounds)
    window.backgroundColor = .systemBackground
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(window: window, navigationController: navigationController)
    window.rootViewController = navigationController
    window.makeKeyAndVisible()
    self.window = window
    self.coordinator = coordinator
    coordinator.start()

    // Register for remote notifications if permission was previously granted.
    // The first-time permission prompt is triggered from Settings instead.
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      if settings.authorizationStatus == .authorized {
        DispatchQueue.main.async { application.registerForRemoteNotifications() }
      }
    }

    return true
  }

  // MARK: - APNs registration

  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    coordinator?.uploadPushToken(hex)
  }

  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    print("[apns] Registration failed:", error)
  }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
  // Show banners even when the app is in foreground
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    handler([.banner, .sound, .badge])
  }

  // Handle notification tap → deep link
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler handler: @escaping () -> Void
  ) {
    let userInfo = response.notification.request.content.userInfo
    let category = response.notification.request.content.categoryIdentifier

    switch category {
    case "APPROVALS":
      coordinator?.showInbox()
    case "CHAT_MESSAGE":
      if let sessionId = userInfo["sessionId"] as? String, !sessionId.isEmpty {
        coordinator?.openChatById(sessionId)
      }
    default:
      break
    }

    // Clear the badge once user responds to a notification
    UIApplication.shared.applicationIconBadgeNumber = 0
    handler()
  }
}
