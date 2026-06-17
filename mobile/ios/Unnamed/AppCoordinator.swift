import UIKit

final class AppCoordinator {
  private let navigationController: UINavigationController
  private let session: AppSession

  init(navigationController: UINavigationController, session: AppSession = .shared) {
    self.navigationController = navigationController
    self.session = session
    self.navigationController.navigationBar.prefersLargeTitles = true

    let appearance = UINavigationBarAppearance()
    appearance.configureWithOpaqueBackground()
    appearance.backgroundColor = AppTheme.canvas
    appearance.shadowColor = AppTheme.border
    UINavigationBar.appearance().standardAppearance = appearance
    UINavigationBar.appearance().scrollEdgeAppearance = appearance
    UINavigationBar.appearance().compactAppearance = appearance
    UINavigationBar.appearance().tintColor = AppTheme.accent
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
    controller.onShowChats = { [weak self] in self?.showChats() }
    controller.onShowChat = { [weak self] chat in self?.showChat(chatSession: chat) }
    controller.onShowInbox = { [weak self] in self?.showInbox() }
    controller.onShowProjects = { [weak self] in self?.showProjects() }
    navigationController.setViewControllers([controller], animated: true)
  }

  func showInbox() {
    let controller = ApprovalsViewController(appSession: session)
    navigationController.pushViewController(controller, animated: true)
  }

  func showProjects() {
    let controller = ProjectsViewController(appSession: session)
    controller.onSelectProject = { [weak self] project in self?.showProjectDetail(project: project) }
    navigationController.pushViewController(controller, animated: true)
  }

  func showProjectDetail(project: Project) {
    let controller = ProjectDetailViewController(appSession: session, project: project)
    controller.onShowChat = { [weak self] chat in self?.showChat(chatSession: chat) }
    navigationController.pushViewController(controller, animated: true)
  }

  func showChats() {
    let controller = ChatsListViewController(appSession: session)
    controller.onSelectChat = { [weak self] chat in self?.showChat(chatSession: chat) }
    navigationController.pushViewController(controller, animated: true)
  }

  func showChat(chatSession: ChatSession) {
    let controller = ChatViewController(appSession: session, chatSession: chatSession)
    navigationController.pushViewController(controller, animated: true)
  }
}
