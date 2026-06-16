import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  private var coordinator: AppCoordinator?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let navigationController = UINavigationController()
    let coordinator = AppCoordinator(navigationController: navigationController)
    window.rootViewController = navigationController
    window.makeKeyAndVisible()
    self.window = window
    self.coordinator = coordinator
    coordinator.start()
    return true
  }
}
