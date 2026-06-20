import UIKit

@MainActor
final class AppCoordinator {
  private let navigationController: UINavigationController
  private let session: AppSession
  private var slideOver: SlideOverController?
  /// The single persistent nav stack behind the slide-over: chat is always its
  /// root; Projects/Project detail/Settings push onto it like normal drill-downs.
  private var mainNav: UINavigationController?
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
    navigationController.setNavigationBarHidden(false, animated: false)
    let controller = ConnectViewController(session: session)
    controller.onConnectedWithoutAuth = { [weak self] in self?.showHome() }
    controller.onNeedsLogin = { [weak self] in self?.showLogin() }
    navigationController.setViewControllers([controller], animated: false)
  }

  func showLogin() {
    navigationController.setNavigationBarHidden(false, animated: false)
    let controller = LoginViewController(session: session)
    controller.onSignedIn = { [weak self] in self?.showHome() }
    controller.onChangeServer = { [weak self] in self?.showConnect() }
    navigationController.setViewControllers([controller], animated: true)
  }

  func showHome() {
    WebSocketService.shared.connect()
    ApprovalCenter.shared.start()
    Task { @MainActor [weak self] in
      guard let self else { return }
      // Refresh the badge count from the server on launch.
      if let pending = try? await client.pendingApprovals() {
        ApprovalCenter.shared.setCount(pending.count)
      }
      let chats = (try? await client.sessions()) ?? []
      let mainNav = UINavigationController(rootViewController: makeChatVC(for: chats.first))
      mainNav.navigationBar.prefersLargeTitles = false
      self.mainNav = mainNav
      let sidebar = makeSidebar()
      let slide = SlideOverController(main: mainNav, side: sidebar)
      slide.onWillOpenSide = { [weak sidebar] in sidebar?.reload() }
      self.slideOver = slide
      navigationController.setNavigationBarHidden(true, animated: false)
      navigationController.setViewControllers([slide], animated: true)
    }
  }

  /// A bare chat screen (not nav-wrapped) — used as mainNav's root.
  private func makeChatVC(for chat: ChatSession?) -> ChatViewController {
    let chatSession = chat ?? ChatSession(id: "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
    let vc = ChatViewController(appSession: self.session, chatSession: chatSession, isNew: chat == nil)
    vc.onOpenSidebar = { [weak self] in self?.slideOver?.openSide() }
    return vc
  }

  private func makeSidebar() -> SidebarViewController {
    let sidebar = SidebarViewController(appSession: session)
    sidebar.onNewChat = { [weak self] in self?.openChat(nil) }
    sidebar.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebar.onShowProjects = { [weak self] in self?.showProjects() }
    sidebar.onShowInbox = { [weak self] in self?.presentInbox() }
    sidebar.onShowSettings = { [weak self] in self?.showSettings() }
    return sidebar
  }

  /// Switch the active chat: replaces mainNav's root (clearing any pushed
  /// Projects/Settings/etc. above it) and closes the drawer.
  private func openChat(_ chat: ChatSession?) {
    guard let slide = slideOver, let mainNav else { return }
    if let chat {
      mainNav.setViewControllers([makeChatVC(for: chat)], animated: false)
      slide.closeSide()
    } else {
      Task { @MainActor [weak self] in
        guard let self else { return }
        let created = try? await client.createSession(title: nil)
        let new = ChatSession(id: created?.id ?? "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        mainNav.setViewControllers([self.makeChatVC(for: new)], animated: false)
        slide.closeSide()
      }
    }
  }

  /// Pushes Projects onto the shared chat nav stack — back returns to chat.
  private func showProjects() {
    slideOver?.closeSide()
    guard let mainNav else { return }
    let controller = ProjectsViewController(appSession: session)
    controller.onSelectProject = { [weak self] project in self?.pushProjectDetail(project) }
    mainNav.pushViewController(controller, animated: true)
  }

  private func pushProjectDetail(_ project: Project) {
    guard let mainNav else { return }
    let controller = ProjectDetailViewController(appSession: session, project: project)
    controller.onShowChat = { [weak self] chat in self?.openChat(chat) }
    mainNav.pushViewController(controller, animated: true)
  }

  /// Public entry point for deep-linking into the Inbox (e.g. from a notification tap).
  func showInbox() {
    presentInbox()
  }

  /// Inbox stays a sheet — a transient, quick-action surface, unlike Projects/Settings.
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

  /// Pushes Settings onto the shared chat nav stack — back returns to chat.
  private func showSettings() {
    slideOver?.closeSide()
    guard let mainNav else { return }
    let vc = SettingsViewController(email: session.cachedEmail ?? "—", serverURL: session.serverURL)
    vc.onChangeServer = { [weak self] in self?.showConnect() }
    vc.onSignOut = { [weak self] in
      WebSocketService.shared.disconnect()
      self?.session.clearToken()
      self?.showLogin()
    }
    mainNav.pushViewController(vc, animated: true)
  }
}
