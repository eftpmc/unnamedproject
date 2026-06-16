import UIKit

final class AppCoordinator {
  private let navigationController: UINavigationController
  private let session: AppSession

  init(navigationController: UINavigationController, session: AppSession = .shared) {
    self.navigationController = navigationController
    self.session = session
    self.navigationController.navigationBar.prefersLargeTitles = true
  }

  func start() {
    if session.serverURL == nil {
      showConnect()
    } else if session.token == nil {
      showLogin()
    } else {
      showDashboard()
    }
  }

  func showConnect() {
    let controller = ConnectViewController(session: session)
    controller.onConnectedWithoutAuth = { [weak self] in self?.showDashboard() }
    controller.onNeedsLogin = { [weak self] in self?.showLogin() }
    navigationController.setViewControllers([controller], animated: false)
  }

  func showLogin() {
    let controller = LoginViewController(session: session)
    controller.onSignedIn = { [weak self] in self?.showDashboard() }
    controller.onChangeServer = { [weak self] in self?.showConnect() }
    navigationController.setViewControllers([controller], animated: true)
  }

  func showDashboard() {
    let controller = DashboardViewController(session: session)
    controller.onSignedOut = { [weak self] in
      self?.session.clearToken()
      self?.showLogin()
    }
    controller.onChangeServer = { [weak self] in self?.showConnect() }
    navigationController.setViewControllers([controller], animated: true)
  }
}
