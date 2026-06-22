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
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(window: window, navigationController: navigationController)
    window.rootViewController = navigationController
    window.makeKeyAndVisible()
    self.window = window
    self.coordinator = coordinator
    coordinator.start()
    return true
  }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
  // Show notification banners even when app is in foreground
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler handler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    handler([.banner, .sound, .badge])
  }

  // Handle notification tap → navigate to Inbox
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler handler: @escaping () -> Void
  ) {
    if response.notification.request.content.categoryIdentifier == "APPROVALS" {
      coordinator?.showInbox()
    }
    handler()
  }
}
