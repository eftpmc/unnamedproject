import UIKit

@MainActor
final class AppCoordinator {
  private weak var window: UIWindow?
  private let navigationController: UINavigationController
  private let session: AppSession
  private var splitVC: UISplitViewController?
  /// The single persistent nav stack behind the slide-over: chat is always its
  /// root; Projects/Project detail push onto it like normal drill-downs.
  private var mainNav: UINavigationController?
  private var sidebarNav: UINavigationController?
  private lazy var client = APIClient(session: session)

  init(window: UIWindow, navigationController: UINavigationController, session: AppSession = .shared) {
    self.window = window
    self.navigationController = navigationController
    self.session = session
    self.navigationController.navigationBar.prefersLargeTitles = true

    let appearance = UINavigationBarAppearance()
    appearance.configureWithTransparentBackground()
    appearance.shadowColor = nil
    appearance.titleTextAttributes = [.font: UIFont.app(forTextStyle: .headline)]
    appearance.largeTitleTextAttributes = [.font: UIFont.app(forTextStyle: .largeTitle, weight: .bold)]
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
      // Allow large titles on the shell so pushed list screens (Projects)
      // get them; Chat opts out per-VC via largeTitleDisplayMode.
      mainNav.navigationBar.prefersLargeTitles = true
      mainNav.navigationBar.tintColor = AppPalette.accent
      self.mainNav = mainNav

      let sidebar = makeSidebar()
      sidebar.reload()
      let sidebarNav = UINavigationController(rootViewController: sidebar)
      sidebarNav.navigationBar.prefersLargeTitles = true
      sidebarNav.navigationBar.tintColor = AppPalette.accent
      self.sidebarNav = sidebarNav

      let split = UISplitViewController(style: .doubleColumn)
      split.viewControllers = [sidebarNav, mainNav]
      // Visible-by-default but user-collapsible on iPad, matching HIG guidance.
      // On iPhone (collapsed), the sidebar is the navigation root — selecting a
      // chat pushes it on top, with the system back chevron returning to the
      // sidebar, so there's nothing for the sidebar to "close" to.
      split.preferredDisplayMode = .oneBesideSecondary
      split.preferredSplitBehavior = .tile
      split.presentsWithGesture = true
      split.delegate = self
      self.splitVC = split

      self.showRoot(split)
      if split.isCollapsed {
        split.show(.primary)
      }
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
    vc.onJumpToChat = { [weak self] chat in self?.openChat(chat) }
    vc.onNewChat = { [weak self] in self?.openChat(nil) }
    vc.onShowSettings = { [weak self] in self?.showSettings() }
    return vc
  }

  private func makeSidebar() -> SidebarViewController {
    let sidebar = SidebarViewController(appSession: session)
    sidebar.onNewChat = { [weak self] in self?.openChat(nil) }
    sidebar.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebar.onShowChats = { [weak self] in self?.showChats() }
    sidebar.onShowProjects = { [weak self] in self?.showProjects() }
    sidebar.onShowInbox = { [weak self] in self?.presentInbox() }
    sidebar.onShowSettings = { [weak self] in self?.showSettings() }
    return sidebar
  }

  /// Pushes the full chat history onto the sidebar's own nav stack — back
  /// returns to the sidebar (this is a sidebar-column destination, unlike
  /// Projects which live in the chat-area stack).
  private func showChats() {
    let controller = ChatsViewController(appSession: session)
    controller.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebarNav?.pushViewController(controller, animated: true)
  }

  /// Switch the active chat: resets the visible content stack down to just
  /// the new chat (clearing any pushed Projects/etc. above it).
  private func openChat(_ chat: ChatSession?) {
    guard splitVC != nil else { return }
    if let chat {
      showChat(chat)
    } else {
      Task { @MainActor [weak self] in
        guard let self else { return }
        let created = try? await client.createSession(title: nil)
        let new = ChatSession(id: created?.id ?? "", title: nil, effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        self.showChat(new)
      }
    }
  }

  private func showChat(_ chat: ChatSession) {
    guard let splitVC else { return }
    mainNav?.setViewControllers([makeChatVC(for: chat)], animated: false)

    if splitVC.isCollapsed, let sidebarNav, let root = sidebarNav.viewControllers.first {
      sidebarNav.setViewControllers([root, makeChatVC(for: chat)], animated: true)
    } else {
      splitVC.show(.secondary)
    }
  }

  /// Pushes `vc` onto the active chat-area stack.
  private func pushMainContent(_ vc: UIViewController) {
    guard let splitVC else { return }
    mainNav?.pushViewController(vc, animated: true)
    splitVC.show(.secondary)
  }

  private func showProjects() {
    let controller = ProjectsViewController(appSession: session)
    controller.onSelectProject = { [weak self] project in self?.pushProjectDetail(project) }
    if splitVC?.isCollapsed == true {
      sidebarNav?.pushViewController(controller, animated: true)
    } else {
      pushMainContent(controller)
    }
  }

  private func pushProjectDetail(_ project: Project) {
    let controller = ProjectDetailViewController(appSession: session, project: project)
    controller.onShowChat = { [weak self] chat in self?.openChat(chat) }
    if splitVC?.isCollapsed == true {
      sidebarNav?.pushViewController(controller, animated: true)
    } else {
      mainNav?.pushViewController(controller, animated: true)
    }
  }

  /// Public entry point for deep-linking into the Inbox (e.g. from a notification tap).
  func showInbox() {
    presentInbox()
  }

  /// Inbox stays a sheet — a transient, quick-action surface, unlike Projects.
  private func presentInbox() {
    let controller = ApprovalsViewController(appSession: session)
    let nav = UINavigationController(rootViewController: controller)
    nav.navigationBar.prefersLargeTitles = true
    nav.navigationBar.tintColor = AppPalette.accent
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
      sheet.selectedDetentIdentifier = .large
      sheet.prefersGrabberVisible = true
    }
    presentSheet(nav)
  }

  /// Settings is an account surface, so it appears as a transient sheet instead
  /// of becoming part of the chat navigation stack.
  private func showSettings() {
    let vc = SettingsViewController(email: session.cachedEmail ?? "—", serverURL: session.serverURL)
    vc.navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(dismissPresentedSheet))
    vc.onChangeServer = { [weak self] in
      self?.window?.rootViewController?.dismiss(animated: true) {
        self?.showConnect()
      }
    }
    vc.onSignOut = { [weak self] in
      WebSocketService.shared.disconnect()
      self?.session.clearToken()
      self?.window?.rootViewController?.dismiss(animated: true) {
        self?.showLogin()
      }
    }
    let nav = UINavigationController(rootViewController: vc)
    nav.navigationBar.prefersLargeTitles = true
    nav.navigationBar.tintColor = AppPalette.accent
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
      sheet.selectedDetentIdentifier = .large
      sheet.prefersGrabberVisible = true
    }
    presentSheet(nav)
  }

  /// Presents a sheet, dismissing any already-presented sheet first so that
  /// a second call (e.g. tapping Settings while Inbox is open) never silently
  /// no-ops due to UIKit's single-presenter constraint.
  private func presentSheet(_ nav: UINavigationController) {
    guard let root = window?.rootViewController else { return }
    if root.presentedViewController != nil {
      root.dismiss(animated: true) { root.present(nav, animated: true) }
    } else {
      root.present(nav, animated: true)
    }
  }

  @objc private func dismissPresentedSheet() {
    window?.rootViewController?.dismiss(animated: true)
  }
}

extension AppCoordinator: UISplitViewControllerDelegate {
  /// On iPhone the split view collapses to a single stack. Returning `.primary`
  /// here keeps the sidebar as that stack's root instead of the chat.
  func splitViewController(_ splitViewController: UISplitViewController, topColumnForCollapsingToProposedTopColumn proposedTopColumn: UISplitViewController.Column) -> UISplitViewController.Column {
    .primary
  }
}
