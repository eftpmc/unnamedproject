import UIKit

final class AppCoordinator {
  private let navigationController: UINavigationController
  private let session: AppSession
  private var slideOver: SlideOverController?
  private lazy var client = APIClient(session: session)

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
      showHome()
    }
  }

  func showConnect() {
    let controller = ConnectViewController(session: session)
    controller.onConnectedWithoutAuth = { [weak self] in self?.showHome() }
    controller.onNeedsLogin = { [weak self] in self?.showLogin() }
    navigationController.setViewControllers([controller], animated: false)
  }

  func showLogin() {
    let controller = LoginViewController(session: session)
    controller.onSignedIn = { [weak self] in self?.showHome() }
    controller.onChangeServer = { [weak self] in self?.showConnect() }
    navigationController.setViewControllers([controller], animated: true)
  }

  func showHome() {
    WebSocketService.shared.connect()
    ApprovalCenter.shared.start()
    Task {
      // Refresh the badge count from the server on launch.
      if let pending = try? await client.pendingApprovals() {
        ApprovalCenter.shared.setCount(pending.count)
      }
      let chats = (try? await client.sessions()) ?? []
      let root = makeChatVC(for: chats.first) // already nav-wrapped; most-recent chat, or new-chat empty state if nil
      let sidebar = makeSidebar()
      let slide = SlideOverController(main: root, side: sidebar)
      slide.onWillOpenSide = { [weak sidebar] in sidebar?.reload() }
      self.slideOver = slide
      navigationController.setViewControllers([slide], animated: true)
    }
  }

  /// The chat screen, embedded in its own nav controller so it keeps a native
  /// nav bar (sidebar button / title / compose) inside the slide-over.
  private func makeChatVC(for chat: ChatSession?) -> UINavigationController {
    let session = chat ?? ChatSession(id: "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
    let vc = ChatViewController(appSession: self.session, chatSession: session, isNew: chat == nil)
    vc.onOpenSidebar = { [weak self] in self?.slideOver?.openSide() }
    return wrapInNav(vc)
  }

  private func wrapInNav(_ vc: UIViewController) -> UINavigationController {
    let nav = UINavigationController(rootViewController: vc)
    nav.navigationBar.prefersLargeTitles = false
    return nav
  }

  private func makeSidebar() -> SidebarViewController {
    let sidebar = SidebarViewController(appSession: session)
    sidebar.onNewChat = { [weak self] in self?.openChat(nil) }
    sidebar.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebar.onShowProjects = { [weak self] in self?.presentProjects() }
    sidebar.onShowInbox = { [weak self] in self?.presentInbox() }
    sidebar.onShowSettings = { [weak self] in self?.presentSettings() }
    return sidebar
  }

  /// Swap the slide-over's main controller to a (possibly new) chat and close the drawer.
  private func openChat(_ chat: ChatSession?) {
    guard let slide = slideOver else { return }
    if let chat {
      slide.setMain(makeChatVC(for: chat))
      slide.closeSide()
    } else {
      Task {
        let created = try? await client.createSession(title: nil)
        let new = ChatSession(id: created?.id ?? "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        slide.setMain(makeChatVC(for: new))
        slide.closeSide()
      }
    }
  }

  private func presentProjects() {
    slideOver?.closeSide()
    let controller = ProjectsViewController(appSession: session)
    controller.onSelectProject = { [weak self] project in self?.pushProjectDetail(project) }
    let nav = UINavigationController(rootViewController: controller)
    controller.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .close, target: self, action: #selector(dismissPresented))
    navigationController.present(nav, animated: true)
  }

  private func pushProjectDetail(_ project: Project) {
    guard let presented = navigationController.presentedViewController as? UINavigationController else { return }
    let controller = ProjectDetailViewController(appSession: session, project: project)
    controller.onShowChat = { [weak self] chat in
      presented.dismiss(animated: true) { self?.openChat(chat) }
    }
    presented.pushViewController(controller, animated: true)
  }

  /// Public entry point for deep-linking into the Inbox (e.g. from a notification tap).
  func showInbox() {
    presentInbox()
  }

  private func presentInbox() {
    slideOver?.closeSide()
    let controller = ApprovalsViewController(appSession: session)
    let nav = UINavigationController(rootViewController: controller)
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
      sheet.prefersGrabberVisible = true
    }
    navigationController.present(nav, animated: true)
  }

  private func presentSettings() {
    slideOver?.closeSide()
    let vc = SettingsViewController(email: session.cachedEmail ?? "—", serverURL: session.serverURL)
    vc.onChangeServer = { [weak self] in self?.navigationController.dismiss(animated: true) { self?.showConnect() } }
    vc.onSignOut = { [weak self] in
      self?.navigationController.dismiss(animated: true) {
        WebSocketService.shared.disconnect()
        self?.session.clearToken()
        self?.showLogin()
      }
    }
    navigationController.present(UINavigationController(rootViewController: vc), animated: true)
  }

  @objc private func dismissPresented() { navigationController.dismiss(animated: true) }
}
