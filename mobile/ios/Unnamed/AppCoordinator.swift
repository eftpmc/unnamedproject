import UIKit

@MainActor
final class AppCoordinator {
  private weak var window: UIWindow?
  private let navigationController: UINavigationController
  private let session: AppSession
  private var splitVC: UISplitViewController?
  /// The single persistent nav stack behind the slide-over: chat is always its
  /// root; Projects/Project detail/Settings push onto it like normal drill-downs.
  private var mainNav: UINavigationController?
  private lazy var client = APIClient(session: session)

  init(window: UIWindow, navigationController: UINavigationController, session: AppSession = .shared) {
    self.window = window
    self.navigationController = navigationController
    self.session = session
    self.navigationController.navigationBar.prefersLargeTitles = true

    let appearance = UINavigationBarAppearance()
    appearance.configureWithOpaqueBackground()
    appearance.backgroundColor = .systemBackground
    appearance.shadowColor = .separator
    UINavigationBar.appearance().standardAppearance = appearance
    UINavigationBar.appearance().scrollEdgeAppearance = appearance
    UINavigationBar.appearance().compactAppearance = appearance
    // Bar button icons (sidebar, compose, etc.) pick up the web app's accent
    // instead of stock system blue, so they read consistently with chat.
    // The appearance proxy alone doesn't reliably retint bar button item
    // images, so each UINavigationController also sets tintColor directly.
    UINavigationBar.appearance().tintColor = AppPalette.accent
    self.navigationController.navigationBar.tintColor = AppPalette.accent
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

  /// `UISplitViewController` can't be pushed into a `UINavigationController`'s
  /// stack, so the post-auth shell replaces the window's root directly instead
  /// of living inside `navigationController`. This swaps back to it for the
  /// pre-auth flows (and no-ops if it's already the root).
  private func showRoot(_ vc: UIViewController) {
    guard let window, window.rootViewController !== vc else { return }
    UIView.transition(with: window, duration: 0.3, options: .transitionCrossDissolve, animations: {
      window.rootViewController = vc
    })
  }

  func showConnect() {
    showRoot(navigationController)
    navigationController.setNavigationBarHidden(false, animated: false)
    let controller = ConnectViewController(session: session)
    controller.onConnectedWithoutAuth = { [weak self] in self?.showHome() }
    controller.onNeedsLogin = { [weak self] in self?.showLogin() }
    navigationController.setViewControllers([controller], animated: false)
  }

  func showLogin() {
    showRoot(navigationController)
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
      // Allow large titles on the shell so pushed list screens (Projects,
      // Settings) get them; Chat opts out per-VC via largeTitleDisplayMode.
      mainNav.navigationBar.prefersLargeTitles = true
      mainNav.navigationBar.tintColor = AppPalette.accent
      self.mainNav = mainNav

      let sidebar = makeSidebar()
      sidebar.reload()
      let sidebarNav = UINavigationController(rootViewController: sidebar)
      sidebarNav.navigationBar.prefersLargeTitles = true
      sidebarNav.navigationBar.tintColor = AppPalette.accent

      let split = UISplitViewController(style: .doubleColumn)
      split.viewControllers = [sidebarNav, mainNav]
      // Visible-by-default but user-collapsible, matching the HIG guidance for
      // sidebars: discoverable on first launch, but the chat's sidebar-toggle
      // button (and the system's own edge-swipe) can still hide it on iPad.
      split.preferredDisplayMode = .oneBesideSecondary
      split.preferredSplitBehavior = .tile
      split.presentsWithGesture = true
      self.splitVC = split

      self.showRoot(split)
    }
  }

  /// Reveals the sidebar when collapsed (iPhone), or toggles its persistent
  /// column open/closed when not (iPad) — the same button drives both.
  private func toggleSidebar() {
    guard let splitVC else { return }
    if splitVC.isCollapsed {
      splitVC.show(.primary)
    } else {
      splitVC.preferredDisplayMode = splitVC.displayMode == .secondaryOnly ? .oneBesideSecondary : .secondaryOnly
    }
  }

  /// A bare chat screen (not nav-wrapped) — used as mainNav's root.
  private func makeChatVC(for chat: ChatSession?) -> ChatViewController {
    let chatSession = chat ?? ChatSession(id: "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
    let vc = ChatViewController(appSession: self.session, chatSession: chatSession, isNew: chat == nil)
    vc.onOpenSidebar = { [weak self] in self?.toggleSidebar() }
    vc.onDeleted = { [weak self] in self?.openChat(nil) }
    return vc
  }

  private func makeSidebar() -> SidebarViewController {
    let sidebar = SidebarViewController(appSession: session)
    sidebar.onNewChat = { [weak self] in self?.openChat(nil) }
    sidebar.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebar.onShowProjects = { [weak self] in self?.showProjects() }
    sidebar.onShowInbox = { [weak self] in self?.presentInbox() }
    sidebar.onShowSettings = { [weak self] in self?.showSettings() }
    sidebar.onClose = { [weak self] in self?.splitVC?.show(.secondary) }
    return sidebar
  }

  /// Switch the active chat: resets the visible content stack down to just
  /// the new chat (clearing any pushed Projects/Settings/etc. above it).
  private func openChat(_ chat: ChatSession?) {
    guard splitVC != nil else { return }
    if let chat {
      present(makeChatVC(for: chat), resettingStack: true)
    } else {
      Task { @MainActor [weak self] in
        guard let self else { return }
        let created = try? await client.createSession(title: nil)
        let new = ChatSession(id: created?.id ?? "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        self.present(self.makeChatVC(for: new), resettingStack: true)
      }
    }
  }

  /// Shows `vc` as the active chat-area content. When `resettingStack` is
  /// true (switching chats), any previously pushed Projects/Settings/etc.
  /// above the current chat is dropped first.
  private func present(_ vc: UIViewController, resettingStack: Bool) {
    guard let splitVC else { return }
    if resettingStack {
      mainNav?.setViewControllers([vc], animated: false)
    } else {
      mainNav?.pushViewController(vc, animated: true)
    }
    splitVC.show(.secondary)
  }

  /// Pushes Projects onto the active chat-area stack — back returns to chat.
  private func showProjects() {
    let controller = ProjectsViewController(appSession: session)
    controller.onSelectProject = { [weak self] project in self?.pushProjectDetail(project) }
    present(controller, resettingStack: false)
  }

  private func pushProjectDetail(_ project: Project) {
    let controller = ProjectDetailViewController(appSession: session, project: project)
    controller.onShowChat = { [weak self] chat in self?.openChat(chat) }
    mainNav?.pushViewController(controller, animated: true)
  }

  /// Public entry point for deep-linking into the Inbox (e.g. from a notification tap).
  func showInbox() {
    presentInbox()
  }

  /// Inbox stays a sheet — a transient, quick-action surface, unlike Projects/Settings.
  private func presentInbox() {
    let controller = ApprovalsViewController(appSession: session)
    let nav = UINavigationController(rootViewController: controller)
    nav.navigationBar.prefersLargeTitles = true
    nav.navigationBar.tintColor = AppPalette.accent
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
      sheet.prefersGrabberVisible = true
    }
    window?.rootViewController?.present(nav, animated: true)
  }

  /// Pushes Settings onto the active chat-area stack — back returns to chat.
  private func showSettings() {
    let vc = SettingsViewController(email: session.cachedEmail ?? "—", serverURL: session.serverURL)
    vc.onChangeServer = { [weak self] in self?.showConnect() }
    vc.onSignOut = { [weak self] in
      WebSocketService.shared.disconnect()
      self?.session.clearToken()
      self?.showLogin()
    }
    present(vc, resettingStack: false)
  }
}
