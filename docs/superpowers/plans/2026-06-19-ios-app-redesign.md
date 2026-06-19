# iOS App UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the iOS app's hub-and-spoke dashboard with a chat-first root + slide-over sidebar (ChatGPT/Claude-inspired), fix chat rendering so only the user gets bubbles, and restyle every screen with native iOS conventions.

**Architecture:** UIKit, programmatic Auto Layout, single `UINavigationController`. The chat screen becomes the navigation root. A custom slide-over container hosts a sidebar (search, new chat, projects/inbox, time-grouped recents, account). Approval badge/notification ownership moves out of the deleted dashboard into a shared `ApprovalCenter` subscribed to `WebSocketService`. No server/API/WebSocket protocol changes.

**Tech Stack:** Swift, UIKit, URLSession (existing `APIClient`), existing `WebSocketService`, SF Symbols, `AppTheme` palette.

## Global Constraints

- No server/API/WebSocket protocol changes. Use only existing `APIClient` methods and existing `WSEvent` cases.
- Keep the existing `AppTheme` warm palette (canvas/surface/secondarySurface/border/primary/primaryText/accent/warning).
- No all-caps / uppercase section labels anywhere.
- Dynamic Type: use `UIFont.preferredFont` + `adjustsFontForContentSizeCategory` (match existing patterns).
- Support light + dark mode (colors via `AppTheme` dynamic colors).
- There is **no iOS test target**. The per-task verification cycle is: `xcodebuild` build succeeds, then the listed manual Simulator checks. Pure-logic helpers are verified with the `swift` CLI where noted.
- Build command (used throughout):
  ```bash
  cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed \
    -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
  ```
- Work happens on branch `redesign/ios-app` (already created; the spec is committed there).

---

### Task 1: ApprovalCenter — shared badge/notification owner

Deleting `DashboardViewController` (Task 4) removes the only `WebSocketService` subscription that tracks pending-approval count, schedules local notifications, and sets the app badge. Extract that responsibility into a singleton that lives for the app's lifetime.

**Files:**
- Create: `mobile/ios/Unnamed/ApprovalCenter.swift`
- Reference (logic source): `mobile/ios/Unnamed/DashboardViewController.swift:60-67, 373-392, 467-485`

**Interfaces:**
- Produces:
  - `final class ApprovalCenter` with `static let shared`
  - `func start()` — subscribes to `WebSocketService.shared` and requests notification auth (idempotent)
  - `var count: Int { get }` — current pending-approval count
  - `func setCount(_ n: Int)` — set from an API refresh (`pendingApprovals().count`)
  - `func clear()` — zero the count (used when the inbox is viewed)
  - `Notification.Name.approvalCountChanged` — posted whenever `count` changes, so any visible screen can update its badge

- [ ] **Step 1: Create the ApprovalCenter**

```swift
// mobile/ios/Unnamed/ApprovalCenter.swift
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
```

- [ ] **Step 2: Add the file to the Xcode project**

Open `mobile/ios/Unnamed.xcworkspace` in Xcode once so the new `.swift` file is picked up by the `Unnamed` target (Xcode auto-adds files in the group folder on modern project formats; if the project uses explicit file references, drag `ApprovalCenter.swift` into the `Unnamed` group and ensure target membership is checked). Then build.

- [ ] **Step 3: Build to verify it compiles**

Run:
```bash
cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build
```
Expected: **BUILD SUCCEEDED**. (ApprovalCenter is not wired in yet — that happens in Task 4. It just needs to compile.)

- [ ] **Step 4: Commit**

```bash
git add mobile/ios/Unnamed/ApprovalCenter.swift mobile/ios/Unnamed.xcodeproj/project.pbxproj
git commit -m "feat(ios): add ApprovalCenter for app-lifetime approval badge/notifications"
```

---

### Task 2: SlideOverController — the sidebar drawer container

UIKit ships no drawer. Build a reusable container that hosts a "main" view controller and presents a "side" panel over a dimmed scrim, openable by button or left-edge pan, dismissible by tap-scrim / drag / swipe.

**Files:**
- Create: `mobile/ios/Unnamed/SlideOverController.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `final class SlideOverController: UIViewController`
  - `init(main: UIViewController, side: UIViewController)`
  - `var sideWidthRatio: CGFloat` (default `0.84`)
  - `func openSide(animated: Bool)` / `func closeSide(animated: Bool)`
  - `func setMain(_ vc: UIViewController)` — swap the main controller (used when the sidebar picks a different chat)

- [ ] **Step 1: Create the SlideOverController**

```swift
// mobile/ios/Unnamed/SlideOverController.swift
import UIKit

final class SlideOverController: UIViewController {
  let sideWidthRatio: CGFloat = 0.84

  private var mainVC: UIViewController
  private let sideVC: UIViewController
  private let scrim = UIControl()
  private let sideContainer = UIView()
  private var sideLeading: NSLayoutConstraint!
  private var isOpen = false

  init(main: UIViewController, side: UIViewController) {
    self.mainVC = main
    self.sideVC = side
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  private var sideWidth: CGFloat { view.bounds.width * sideWidthRatio }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = AppTheme.canvas

    addChild(mainVC)
    mainVC.view.frame = view.bounds
    mainVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(mainVC.view)
    mainVC.didMove(toParent: self)

    scrim.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    scrim.alpha = 0
    scrim.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrim)
    NSLayoutConstraint.activate([
      scrim.topAnchor.constraint(equalTo: view.topAnchor),
      scrim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scrim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    scrim.addTarget(self, action: #selector(scrimTapped), for: .touchUpInside)

    sideContainer.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(sideContainer)
    sideLeading = sideContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: -1)
    NSLayoutConstraint.activate([
      sideContainer.topAnchor.constraint(equalTo: view.topAnchor),
      sideContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      sideContainer.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: sideWidthRatio),
      sideLeading,
    ])

    addChild(sideVC)
    sideVC.view.frame = sideContainer.bounds
    sideVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sideContainer.addSubview(sideVC.view)
    sideVC.didMove(toParent: self)

    let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgePan(_:)))
    edgePan.edges = .left
    view.addGestureRecognizer(edgePan)

    let drag = UIPanGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
    sideContainer.addGestureRecognizer(drag)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    if !isOpen { sideLeading.constant = -sideWidth - 1 }
  }

  func setMain(_ vc: UIViewController) {
    let old = mainVC
    old.willMove(toParent: nil)
    addChild(vc)
    vc.view.frame = view.bounds
    vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.insertSubview(vc.view, belowSubview: scrim)
    vc.didMove(toParent: self)
    old.view.removeFromSuperview()
    old.removeFromParent()
    mainVC = vc
  }

  func openSide(animated: Bool = true) {
    isOpen = true
    sideLeading.constant = 0
    UIView.animate(withDuration: animated ? 0.28 : 0, delay: 0, options: .curveEaseOut) {
      self.scrim.alpha = 1
      self.view.layoutIfNeeded()
    }
  }

  func closeSide(animated: Bool = true) {
    isOpen = false
    sideLeading.constant = -sideWidth - 1
    UIView.animate(withDuration: animated ? 0.25 : 0, delay: 0, options: .curveEaseIn) {
      self.scrim.alpha = 0
      self.view.layoutIfNeeded()
    }
  }

  @objc private func scrimTapped() { closeSide() }

  @objc private func handleEdgePan(_ g: UIScreenEdgePanGestureRecognizer) {
    let t = g.translation(in: view).x
    switch g.state {
    case .changed:
      sideLeading.constant = min(0, -sideWidth + t)
      scrim.alpha = max(0, min(1, (sideWidth + sideLeading.constant) / sideWidth))
    case .ended, .cancelled:
      (sideWidth + sideLeading.constant) > sideWidth * 0.4 ? openSide() : closeSide()
    default: break
    }
  }

  @objc private func handleDrag(_ g: UIPanGestureRecognizer) {
    let t = g.translation(in: view).x
    switch g.state {
    case .changed:
      sideLeading.constant = min(0, t)
      scrim.alpha = max(0, min(1, (sideWidth + sideLeading.constant) / sideWidth))
    case .ended, .cancelled:
      let v = g.velocity(in: view).x
      (sideLeading.constant > -sideWidth * 0.5 && v > -500) ? openSide() : closeSide()
    default: break
    }
  }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run the standard build command.
Expected: **BUILD SUCCEEDED**. (Not wired in until Task 4.)

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/SlideOverController.swift mobile/ios/Unnamed.xcodeproj/project.pbxproj
git commit -m "feat(ios): add SlideOverController drawer container"
```

---

### Task 3: Chat time-grouping helper + SidebarViewController

The sidebar groups recent chats by time and lets the user search, start a new chat, reach Projects/Inbox/Settings, and switch chats. First add a pure grouping function (with a real `swift`-CLI test), then build the sidebar UI on top of it.

**Files:**
- Modify: `mobile/ios/Unnamed/UIHelpers.swift` (append `groupChatsByTime`)
- Create: `mobile/ios/Unnamed/SidebarViewController.swift`
- Temp test: `/tmp/grouptest.swift`

**Interfaces:**
- Consumes: `ChatSession` (Models.swift), `APIClient`, `AppSession`, `ApprovalCenter`.
- Produces:
  - In UIHelpers: `enum ChatTimeGroup: Int { case today, yesterday, last7, older }` with `var label: String`; and `func groupChatsByTime(_ chats: [ChatSession], now: Date = Date()) -> [(group: ChatTimeGroup, chats: [ChatSession])]` — sorted newest-first within each group, groups omitted when empty.
  - `final class SidebarViewController: UIViewController` with `init(appSession: AppSession)` and callbacks:
    - `var onSelectChat: ((ChatSession) -> Void)?`
    - `var onNewChat: (() -> Void)?`
    - `var onShowProjects: (() -> Void)?`
    - `var onShowInbox: (() -> Void)?`
    - `var onShowSettings: (() -> Void)?`
    - `func reload()` — refetch sessions/active/profile and re-render

- [ ] **Step 1: Write the failing test for grouping**

```swift
// /tmp/grouptest.swift  — run with: swift /tmp/grouptest.swift
import Foundation

// --- paste of the types under test (kept in sync with UIHelpers.swift) ---
struct ChatSession {
  let id: String; let title: String?
  let createdAt: Int?; let updatedAt: Int?
}
enum ChatTimeGroup: Int { case today, yesterday, last7, older
  var label: String { switch self {
    case .today: return "Today"; case .yesterday: return "Yesterday"
    case .last7: return "Previous 7 Days"; case .older: return "Older" } }
}
func groupChatsByTime(_ chats: [ChatSession], now: Date = Date()) -> [(group: ChatTimeGroup, chats: [ChatSession])] {
  let cal = Calendar.current
  func ts(_ c: ChatSession) -> Int { c.updatedAt ?? c.createdAt ?? 0 }
  func bucket(_ c: ChatSession) -> ChatTimeGroup {
    let d = Date(timeIntervalSince1970: TimeInterval(ts(c)))
    if cal.isDateInToday(d) { return .today }
    if cal.isDateInYesterday(d) { return .yesterday }
    if let days = cal.dateComponents([.day], from: d, to: now).day, days < 7 { return .last7 }
    return .older
  }
  var map: [ChatTimeGroup: [ChatSession]] = [:]
  for c in chats { map[bucket(c), default: []].append(c) }
  return [.today, .yesterday, .last7, .older].compactMap { g in
    guard let items = map[g], !items.isEmpty else { return nil }
    return (g, items.sorted { ts($0) > ts($1) })
  }
}

// --- assertions ---
let now = Date()
let nowTs = Int(now.timeIntervalSince1970)
let chats = [
  ChatSession(id: "a", title: "newer today", createdAt: nil, updatedAt: nowTs - 60),
  ChatSession(id: "b", title: "older today", createdAt: nil, updatedAt: nowTs - 3600),
  ChatSession(id: "c", title: "ten days", createdAt: nil, updatedAt: nowTs - 10*86400),
]
let groups = groupChatsByTime(chats, now: now)
assert(groups.first?.group == .today, "first group should be Today")
assert(groups.first?.chats.map { $0.id } == ["a", "b"], "today sorted newest-first")
assert(groups.contains { $0.group == .older }, "ten-day chat in Older")
assert(!groups.contains { $0.group == .yesterday }, "empty groups omitted")
print("OK")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `swift /tmp/grouptest.swift`
Expected: at this point the file is self-contained and will print `OK`. To confirm the *assertions* are meaningful, temporarily break one (e.g. change `["a", "b"]` to `["b", "a"]`), run, and confirm it traps with an assertion failure. Then restore it and confirm `OK`. (This stands in for a red/green cycle since there is no Xcode test target.)

- [ ] **Step 3: Add `groupChatsByTime` to UIHelpers.swift**

Append to `mobile/ios/Unnamed/UIHelpers.swift` (after `relativeTime`):

```swift
enum ChatTimeGroup: Int {
  case today, yesterday, last7, older
  var label: String {
    switch self {
    case .today: return "Today"
    case .yesterday: return "Yesterday"
    case .last7: return "Previous 7 Days"
    case .older: return "Older"
    }
  }
}

/// Groups chats into Today / Yesterday / Previous 7 Days / Older, newest-first
/// within each group. Empty groups are omitted. Uses updatedAt, falling back to createdAt.
func groupChatsByTime(_ chats: [ChatSession], now: Date = Date()) -> [(group: ChatTimeGroup, chats: [ChatSession])] {
  let cal = Calendar.current
  func ts(_ c: ChatSession) -> Int { c.updatedAt ?? c.createdAt ?? 0 }
  func bucket(_ c: ChatSession) -> ChatTimeGroup {
    let d = Date(timeIntervalSince1970: TimeInterval(ts(c)))
    if cal.isDateInToday(d) { return .today }
    if cal.isDateInYesterday(d) { return .yesterday }
    if let days = cal.dateComponents([.day], from: d, to: now).day, days < 7 { return .last7 }
    return .older
  }
  var map: [ChatTimeGroup: [ChatSession]] = [:]
  for c in chats { map[bucket(c), default: []].append(c) }
  return [ChatTimeGroup.today, .yesterday, .last7, .older].compactMap { g in
    guard let items = map[g], !items.isEmpty else { return nil }
    return (g, items.sorted { ts($0) > ts($1) })
  }
}
```

- [ ] **Step 4: Create SidebarViewController**

```swift
// mobile/ios/Unnamed/SidebarViewController.swift
import UIKit

final class SidebarViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?
  var onNewChat: (() -> Void)?
  var onShowProjects: (() -> Void)?
  var onShowInbox: (() -> Void)?
  var onShowSettings: (() -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var grouped: [(group: ChatTimeGroup, chats: [ChatSession])] = []
  private var activeIds: Set<String> = []
  private var filter = ""
  private var email = "—"

  private let searchField = UISearchTextField()
  private let tableView = UITableView(frame: .zero, style: .plain)
  private let inboxBadge = UILabel()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = AppTheme.secondarySurface
    setupHeader()
    setupTable()
    setupAccountFooter()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  // Pinned header: search + New chat + Projects + Inbox(badge)
  private let headerStack = UIStackView()

  private func setupHeader() {
    headerStack.axis = .vertical
    headerStack.spacing = 8
    headerStack.isLayoutMarginsRelativeArrangement = true
    headerStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 14, bottom: 6, trailing: 14)

    searchField.placeholder = "Search chats"
    searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

    let newChat = navButton(icon: "square.and.pencil", title: "New chat", primary: true, action: #selector(newChatTapped))
    let projects = navButton(icon: "folder", title: "Projects", primary: false, action: #selector(projectsTapped))
    let inbox = navButton(icon: "tray", title: "Inbox", primary: false, action: #selector(inboxTapped))

    inboxBadge.font = .systemFont(ofSize: 11, weight: .bold)
    inboxBadge.textColor = .white
    inboxBadge.textAlignment = .center
    inboxBadge.backgroundColor = AppTheme.warning
    inboxBadge.layer.cornerRadius = 9
    inboxBadge.clipsToBounds = true
    inboxBadge.isHidden = true
    inboxBadge.translatesAutoresizingMaskIntoConstraints = false
    inbox.addSubview(inboxBadge)
    NSLayoutConstraint.activate([
      inboxBadge.heightAnchor.constraint(equalToConstant: 18),
      inboxBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 22),
      inboxBadge.trailingAnchor.constraint(equalTo: inbox.trailingAnchor, constant: -12),
      inboxBadge.centerYAnchor.constraint(equalTo: inbox.centerYAnchor),
    ])

    headerStack.addArrangedSubview(searchField)
    headerStack.addArrangedSubview(newChat)
    headerStack.addArrangedSubview(projects)
    headerStack.addArrangedSubview(inbox)

    view.addSubview(headerStack)
    headerStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      headerStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
      headerStack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      headerStack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  private func navButton(icon: String, title: String, primary: Bool, action: Selector) -> UIControl {
    let row = UIControl()
    row.backgroundColor = primary ? AppTheme.primary : AppTheme.surface
    row.layer.cornerRadius = 12
    row.layer.cornerCurve = .continuous
    row.heightAnchor.constraint(equalToConstant: 44).isActive = true
    row.addTarget(self, action: action, for: .touchUpInside)

    let img = UIImageView(image: UIImage(systemName: icon))
    img.tintColor = primary ? AppTheme.primaryText : .label
    let label = UILabel()
    label.text = title
    label.font = UIFont.preferredFont(forTextStyle: .subheadline)
    label.textColor = primary ? AppTheme.primaryText : .label

    let stack = UIStackView(arrangedSubviews: [img, label])
    stack.axis = .horizontal
    stack.spacing = 10
    stack.alignment = .center
    stack.isUserInteractionEnabled = false
    row.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
      stack.centerYAnchor.constraint(equalTo: row.centerYAnchor),
    ])
    return row
  }

  private func setupTable() {
    tableView.backgroundColor = .clear
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "chat")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.rowHeight = 46
    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 4),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  private let accountRow = UIControl()
  private let emailLabel = UILabel()

  private func setupAccountFooter() {
    accountRow.backgroundColor = AppTheme.surface
    accountRow.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)

    let avatar = UILabel()
    avatar.backgroundColor = AppTheme.accent
    avatar.textColor = .white
    avatar.font = .systemFont(ofSize: 14, weight: .semibold)
    avatar.textAlignment = .center
    avatar.layer.cornerRadius = 16
    avatar.clipsToBounds = true
    avatar.text = "•"
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.widthAnchor.constraint(equalToConstant: 32).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 32).isActive = true

    emailLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    emailLabel.textColor = .label

    let gear = UIImageView(image: UIImage(systemName: "gearshape"))
    gear.tintColor = .secondaryLabel

    let stack = UIStackView(arrangedSubviews: [avatar, emailLabel, UIView(), gear])
    stack.axis = .horizontal
    stack.spacing = 10
    stack.alignment = .center
    stack.isUserInteractionEnabled = false
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
    accountRow.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.pinToSuperviewEdges()

    let topBorder = UIView()
    topBorder.backgroundColor = AppTheme.border
    accountRow.addSubview(topBorder)
    topBorder.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      topBorder.topAnchor.constraint(equalTo: accountRow.topAnchor),
      topBorder.leadingAnchor.constraint(equalTo: accountRow.leadingAnchor),
      topBorder.trailingAnchor.constraint(equalTo: accountRow.trailingAnchor),
      topBorder.heightAnchor.constraint(equalToConstant: 0.5),
    ])

    view.addSubview(accountRow)
    accountRow.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      accountRow.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      accountRow.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      accountRow.topAnchor.constraint(equalTo: tableView.bottomAnchor),
      accountRow.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  func reload() {
    Task {
      async let sessions = client.sessions()
      async let active = client.activeSessions()
      async let profile = try? client.me()
      if let chats = try? await sessions {
        allChats = chats
      }
      activeIds = Set((try? await active) ?? [])
      if let p = await profile { email = p.email }
      applyFilterAndRender()
    }
  }

  private func applyFilterAndRender() {
    let filtered = filter.isEmpty
      ? allChats
      : allChats.filter { ($0.title ?? "").localizedCaseInsensitiveContains(filter) }
    grouped = groupChatsByTime(filtered)
    emailLabel.text = email
    let n = ApprovalCenter.shared.count
    inboxBadge.text = "\(min(n, 99))"
    inboxBadge.isHidden = n == 0
    tableView.reloadData()
  }

  @objc private func searchChanged() { filter = searchField.text ?? ""; applyFilterAndRender() }
  @objc private func newChatTapped() { onNewChat?() }
  @objc private func projectsTapped() { onShowProjects?() }
  @objc private func inboxTapped() { onShowInbox?() }
  @objc private func settingsTapped() { onShowSettings?() }
  @objc private func approvalCountChanged() { applyFilterAndRender() }
}

extension SidebarViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { grouped.count }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { grouped[section].chats.count }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { grouped[section].group.label }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "chat", for: indexPath)
    let chat = grouped[indexPath.section].chats[indexPath.row]
    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled chat"
    content.textProperties.font = UIFont.preferredFont(forTextStyle: .subheadline)
    content.textProperties.numberOfLines = 1
    cell.contentConfiguration = content
    cell.backgroundColor = .clear
    if activeIds.contains(chat.id) {
      let dot = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 8))
      dot.backgroundColor = .systemGreen
      dot.layer.cornerRadius = 4
      cell.accessoryView = dot
    } else {
      cell.accessoryView = nil
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectChat?(grouped[indexPath.section].chats[indexPath.row])
  }
}
```

- [ ] **Step 5: Add `pinToSuperviewEdges` helper to UIHelpers.swift**

The sidebar uses `pinToSuperviewEdges()` (the existing `pinToSuperviewMargins` pins to *margins*, not edges). Append to the `extension UIView` block in `UIHelpers.swift`:

```swift
  func pinToSuperviewEdges() {
    guard let superview else { return }
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: superview.leadingAnchor),
      trailingAnchor.constraint(equalTo: superview.trailingAnchor),
      topAnchor.constraint(equalTo: superview.topAnchor),
      bottomAnchor.constraint(equalTo: superview.bottomAnchor)
    ])
  }
```

- [ ] **Step 6: Build to verify it compiles**

Run the standard build command. Expected: **BUILD SUCCEEDED**.

- [ ] **Step 7: Commit**

```bash
git add mobile/ios/Unnamed/SidebarViewController.swift mobile/ios/Unnamed/UIHelpers.swift mobile/ios/Unnamed.xcodeproj/project.pbxproj
git commit -m "feat(ios): add SidebarViewController + chat time-grouping"
```

---

### Task 4: Rewire AppCoordinator to chat-root + sidebar; delete dashboard

Make the chat screen the root inside a `SlideOverController`, wire the sidebar's callbacks, start `ApprovalCenter`, and delete `DashboardViewController`. Adds a "most recent chat or new chat" launch path.

**Files:**
- Modify: `mobile/ios/Unnamed/AppCoordinator.swift` (full rewrite of the authed portion)
- Delete: `mobile/ios/Unnamed/DashboardViewController.swift`

**Interfaces:**
- Consumes: `SlideOverController`, `SidebarViewController`, `ChatViewController`, `ApprovalCenter`, `APIClient`, all existing callback-based VCs.
- Produces: `AppCoordinator.showHome()` replacing `showDashboard()`; a private `slideOver: SlideOverController?` reference used to open/close the sidebar and swap the main chat.

- [ ] **Step 1: Replace the authed flow in AppCoordinator**

Replace `showDashboard()` and the methods it calls with a chat-root model. The new relevant portion of `AppCoordinator`:

```swift
  private var slideOver: SlideOverController?
  private lazy var client = APIClient(session: session)

  func start() {
    if session.serverURL == nil { showConnect() }
    else if session.token == nil { showLogin() }
    else { showHome() }
  }

  // showConnect() and showLogin() unchanged, except their success callbacks call showHome()

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
      self.slideOver = slide
      navigationController.setViewControllers([slide], animated: true)
    }
  }
```

Add these helpers to `AppCoordinator`:

```swift
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
```

Notes for the implementer:
- `ChatViewController` gains `isNew: Bool` and `onOpenSidebar` in Task 5; this task and Task 5 are adjacent — if building this task alone fails on those symbols, do Task 5's Step 1–3 (the init/property additions) first, or build them together.
- `session.cachedEmail` is added in Step 2 below.
- The old `showInbox`/`showProjects`/`showChats`/`showProjectDetail`/`showChat` push methods are removed; their behavior is replaced by the present/openChat methods above.

- [ ] **Step 2: Add a cached email to AppSession**

Settings/sidebar need the email without an await. In `mobile/ios/Unnamed/AppSession.swift`, add a stored property persisted alongside the token (follow the existing token-persistence pattern in that file):

```swift
  private(set) var cachedEmail: String?
  func setCachedEmail(_ email: String?) {
    cachedEmail = email
    // persist with the same UserDefaults/Keychain mechanism used for token
  }
```

And in `APIClient.me()` callers that already fetch the profile (sidebar `reload()`), call `appSession.setCachedEmail(profile.email)` after a successful fetch. (Add that one line to `SidebarViewController.reload()` where `email = p.email` is set: also `appSession.setCachedEmail(p.email)`.)

- [ ] **Step 3: Delete DashboardViewController**

```bash
git rm mobile/ios/Unnamed/DashboardViewController.swift
```
Remove its file reference from the Xcode project (in Xcode: delete the now-red file reference, or it will already be gone if the project uses folder-synced groups).

- [ ] **Step 4: Build to verify**

Run the standard build command. Expected: **BUILD SUCCEEDED**. If it fails only on `ChatViewController(isNew:)` / `onOpenSidebar`, implement Task 5 Steps 1–3 then rebuild.

- [ ] **Step 5: Manual Simulator verification**

Launch the app (`xcodebuild ... build` then run in Simulator, or run from Xcode). Verify:
- App opens directly into a chat (most recent) or an empty new-chat screen when there are no chats.
- The sidebar button opens the drawer; tapping the scrim / dragging closes it.
- Sidebar: search filters chats; New chat opens a fresh chat; selecting a chat swaps the main screen; Projects/Inbox/Settings open their screens; the account row opens Settings.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(ios): chat-first root + sidebar in AppCoordinator; remove dashboard"
```

---

### Task 5: Chat screen — full-width assistant, inline tools, new nav bar

Change assistant rendering to full-width (no bubble), restyle tool events to sit inline, and add the new nav bar (sidebar button left, tappable title center, compose right). Add `isNew` + `onOpenSidebar`.

**Files:**
- Modify: `mobile/ios/Unnamed/ChatViewController.swift`

**Interfaces:**
- Consumes: `onOpenSidebar` invoked by the coordinator (Task 4).
- Produces:
  - `init(appSession:chatSession:isNew:)` — `isNew` defaults to `false`
  - `var onOpenSidebar: (() -> Void)?`

- [ ] **Step 1: Add `isNew` and `onOpenSidebar`**

Update the stored properties and init:

```swift
  var onOpenSidebar: (() -> Void)?
  private let isNew: Bool

  init(appSession: AppSession, chatSession: ChatSession, isNew: Bool = false) {
    self.appSession = appSession
    self.chatSession = chatSession
    self.isNew = isNew
    super.init(nibName: nil, bundle: nil)
    hidesBottomBarWhenPushed = true
  }
```

- [ ] **Step 2: Replace the nav bar setup in `viewDidLoad`**

Replace the current `navigationItem.rightBarButtonItem = ... arrow.clockwise ...` block with:

```swift
    title = isNew ? "New chat" : (chatSession.title ?? "Chat")
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "sidebar.left"),
      style: .plain, target: self, action: #selector(openSidebarTapped))
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain, target: self, action: #selector(composeNewTapped))
```

Add the actions:

```swift
  @objc private func openSidebarTapped() { onOpenSidebar?() }
  @objc private func composeNewTapped() { onOpenSidebar?() } // sidebar hosts "New chat"
```

(The refresh-on-demand previously on the right bar button is preserved by pull-to-refresh, which already exists via `refreshControl`. Compose routes through the sidebar's New chat so creation stays in one place.)

Guard `loadMessages()` for the empty new-chat case — if `chatSession.id` is empty, skip the fetch and show the empty state:

```swift
  private func loadMessages() {
    guard !chatSession.id.isEmpty else { isLoaded = true; updateEmptyState(); return }
    // ... existing body ...
  }
```

- [ ] **Step 3: Build to verify the nav/init changes compile**

Run the standard build command. Expected: **BUILD SUCCEEDED** (with Task 4 in place).

- [ ] **Step 4: Make assistant messages full-width (no bubble)**

In `MessageCell.configure(with:)`, branch styling by role. Replace the body of `configure` so the assistant turn has no bubble background, spans full content width, and left-aligns; the user turn is unchanged. Update the constraints helpers accordingly:

```swift
  func configure(with message: ChatMessage) {
    rawContent = message.content
    let isUser = message.role == "user"
    let baseFont = UIFont.preferredFont(forTextStyle: .callout)
    let codeBg = UIColor.label.withAlphaComponent(0.08)
    let textColor: UIColor = isUser ? AppTheme.primaryText : .label

    // User keeps a bubble; assistant renders full-width on the canvas.
    bubble.backgroundColor = isUser ? AppTheme.primary : .clear

    contentStack.arrangedSubviews.forEach {
      contentStack.removeArrangedSubview($0); $0.removeFromSuperview()
    }
    for segment in parseMessageSegments(message.content) {
      switch segment {
      case .text(let str): contentStack.addArrangedSubview(makeTextSegment(str, font: baseFont, textColor: textColor, codeBg: codeBg))
      case .code(let code): contentStack.addArrangedSubview(makeCodeSegment(code, textColor: textColor))
      }
    }

    if let epoch = message.createdAt {
      timeLabel.text = messageTime(epoch)
      timeLabel.textAlignment = isUser ? .right : .left
      timeLabel.isHidden = false
    } else {
      timeLabel.isHidden = true
    }

    // Width: user bubble is capped; assistant spans full width.
    bubbleMaxWidth.isActive = isUser
    if isUser {
      stackLeading.isActive = false; stackTrailing.isActive = true
    } else {
      stackTrailing.isActive = false; stackLeading.isActive = true
    }
  }
```

In `MessageCell.init`, the existing `bubbleStack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.82)` must become a *stored, toggleable* constraint so the assistant can go full-width. Change that activation to:

```swift
    bubbleMaxWidth = bubbleStack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.82)
    NSLayoutConstraint.activate([
      bubbleStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 3),
      bubbleStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -3),
    ])
    bubbleMaxWidth.isActive = true
```

and declare the property near the other constraint properties:

```swift
  private var bubbleMaxWidth: NSLayoutConstraint!
```

Also reduce the assistant's inner text inset so full-width text aligns to the canvas margin: in `makeTextSegment`, the leading/trailing `14` insets are fine for the user bubble but should be `0` horizontally for the assistant. Simplest approach that stays DRY: pass an `inset` parameter.

```swift
  private func makeTextSegment(_ text: String, font: UIFont, textColor: UIColor, codeBg: UIColor, hInset: CGFloat = 14) -> UIView {
    // ... same, but use hInset for leading/trailing constants ...
  }
```

and call it with `hInset: isUser ? 14 : 0` from `configure`.

- [ ] **Step 5: Restyle ToolEventCell to sit inline (assistant context)**

In `ToolEventCell.buildLayout()`, drop the heavy bordered pill in favor of a quiet inline chip aligned to the assistant text margin. Change the `pill` styling and leading inset:

```swift
    pill.layer.cornerRadius = 8
    pill.layer.cornerCurve = .continuous
    pill.layer.borderWidth = 0.5
    // ... keep the rest ...
    NSLayoutConstraint.activate([
      pill.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      pill.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -16),
      pill.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      pill.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
```

(Use `lessThanOrEqualTo` + a `pill` content-hugging so the chip is intrinsic-width, not a fixed -80 inset.) Keep the existing running/done/error color treatment.

- [ ] **Step 6: Build + manual verification**

Run the standard build command. Expected: **BUILD SUCCEEDED**.
In Simulator, open a chat with assistant replies and verify:
- User messages are right-aligned dark bubbles; assistant replies are full-width text with no bubble, left-aligned to the margin.
- Code blocks render full-width; tool events show as quiet inline chips with running/done states.
- Streaming a new turn still appends/updates correctly (send a message).
- Long-press copy/share still works on a message.

- [ ] **Step 7: Commit**

```bash
git add mobile/ios/Unnamed/ChatViewController.swift
git commit -m "feat(ios): full-width assistant rendering, inline tools, sidebar nav bar"
```

---

### Task 6: Projects list — inset-grouped, native large title

**Files:**
- Modify: `mobile/ios/Unnamed/ProjectsViewController.swift`

- [ ] **Step 1: Convert to an inset-grouped table with large title**

Change the table style to `.insetGrouped`, set `navigationItem.largeTitleDisplayMode = .always` and the nav controller's `prefersLargeTitles = true` for this screen, title "Projects". Each row uses `defaultContentConfiguration` with `content.text = project.name`, `content.secondaryText = project.repoPath ?? "No repo linked"`, `content.image = UIImage(systemName: "folder")`, tinted `.systemGreen`, and a disclosure indicator. Keep the existing `onSelectProject` callback and data load.

Reference the current file structure and preserve its `APIClient`/load pattern; only the table style, header (drop any custom header in favor of the large title), and cell configuration change.

- [ ] **Step 2: Build + manual verification**

Run the standard build command. Expected: **BUILD SUCCEEDED**.
In Simulator: open Projects from the sidebar; verify a large-title inset-grouped list of projects with repo paths and chevrons; tapping a project pushes its detail.

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/ProjectsViewController.swift
git commit -m "feat(ios): restyle Projects as native inset-grouped list"
```

---

### Task 7: Project detail — segmented control, drop uppercase label

**Files:**
- Modify: `mobile/ios/Unnamed/ProjectDetailViewController.swift`

- [ ] **Step 1: Replace the header with a segmented control and remove the uppercase label**

Replace the custom `tableHeaderView` (which renders the description, repo path, and the **uppercase** `"CHATS"` label) with:
- A header showing description + repo path (monospace) — keep these.
- A `UISegmentedControl` with segments `["Chats", "Plans", "Files"]`, default selected index 0, pinned above the table.
- Remove the `sectionLabel.text = "CHATS"` block entirely (Global Constraint: no uppercase labels).

Wire the segmented control so only "Chats" shows the scoped chat list; "Plans" and "Files" show a centered "Coming soon" empty label (placeholders consistent with the web routes). Keep the existing `load()` filter (`pinnedProjectId == project.id`), the active-chat pulse dot, and the compose ("New chat in project") nav button (`square.and.pencil`).

- [ ] **Step 2: Build + manual verification**

Run the standard build command. Expected: **BUILD SUCCEEDED**.
In Simulator: open a project; verify the segmented control (Chats populated; Plans/Files show "Coming soon"); no uppercase "CHATS" text; "New chat in project" creates and opens a project-scoped chat.

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/ProjectDetailViewController.swift
git commit -m "feat(ios): project detail segmented control; remove uppercase label"
```

---

### Task 8: Inbox presented as a detented sheet

The coordinator already presents `ApprovalsViewController` in a sheet (Task 4, `presentInbox`). This task makes the screen itself sheet-appropriate and ensures viewing it clears the badge.

**Files:**
- Modify: `mobile/ios/Unnamed/ApprovalsViewController.swift`

- [ ] **Step 1: Add a Done button, title, and badge-clear**

Give it `title = "Inbox"`, a right `Done` bar button that dismisses, and call `ApprovalCenter.shared.clear()` (or post `.approvalBadgeCleared`) in `viewDidAppear` so opening the inbox zeroes the badge — matching the existing `.approvalBadgeCleared` behavior. Keep the existing list, approve/deny actions, WS-driven updates, and push to `ApprovalDetailViewController`. Ensure its row styling matches the warm palette (no uppercase headers).

- [ ] **Step 2: Build + manual verification**

Run the standard build command. Expected: **BUILD SUCCEEDED**.
In Simulator: trigger or simulate a pending approval (badge appears on the sidebar Inbox row); open Inbox → it presents as a half-height sheet with a grabber; approve/deny works; the badge clears after viewing; tapping a row pushes the detail.

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/ApprovalsViewController.swift
git commit -m "feat(ios): inbox as detented sheet, clears badge on view"
```

---

### Task 9: Settings — native grouped form

**Files:**
- Modify: `mobile/ios/Unnamed/SettingsViewController.swift`

- [ ] **Step 1: Rebuild as an `.insetGrouped` form**

Sections:
- **Account** — a row with avatar (initial) + email (from the `email` init param).
- **Server** — "Address" row showing `serverURL.host` (+ port), and a "Change server" action row (existing `onChangeServer`).
- **Notifications** — "Approval alerts" row with a `UISwitch`. For now the switch reflects/sets `UIApplication.shared.isRegisteredForRemoteNotifications` state visually; if no persistence exists, store the toggle in `UserDefaults` under `"approvalAlertsEnabled"` (default true) and gate `ApprovalCenter`'s `scheduleNotification` on it. (If wiring the gate is non-trivial, keep the toggle persisting to `UserDefaults` and have `ApprovalCenter.scheduleNotification` early-return when `UserDefaults.standard.object(forKey:"approvalAlertsEnabled")` is `false`.)
- **Sign out** — a destructive row (existing `onSignOut`).

Keep both existing callbacks (`onChangeServer`, `onSignOut`) and the `init(email:serverURL:)` signature.

- [ ] **Step 2: Build + manual verification**

Run the standard build command. Expected: **BUILD SUCCEEDED**.
In Simulator: open Settings; verify grouped sections (Account/Server/Notifications/Sign out), toggle persists across relaunch, Change server and Sign out work.

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/SettingsViewController.swift mobile/ios/Unnamed/ApprovalCenter.swift
git commit -m "feat(ios): native grouped Settings form with notification toggle"
```

---

### Task 10: Connect/Login restyle + full-app verification

**Files:**
- Modify: `mobile/ios/Unnamed/ConnectViewController.swift`, `mobile/ios/Unnamed/LoginViewController.swift`

- [ ] **Step 1: Restyle the pre-auth screens**

Center a brand mark (the "u" tile used elsewhere) + title, use the existing `FormTextField` and `PrimaryButton`, and keep the existing flows/callbacks intact (`onConnectedWithoutAuth`, `onNeedsLogin`, `onSignedIn`, `onChangeServer`). No structural/flow change — visual consistency with the redesigned app only.

- [ ] **Step 2: Build to verify**

Run the standard build command. Expected: **BUILD SUCCEEDED**.

- [ ] **Step 3: Full-app manual verification pass**

In Simulator, walk the entire spec's testing checklist:
- Cold launch with no chats → empty new-chat state; with chats → most-recent chat.
- Sidebar: open via button + left-edge swipe; dismiss via scrim/drag; search; New chat; switch chats; Projects/Inbox/Settings; account row.
- Chat: send a message, observe streaming, full-width assistant, inline tool chips, reconnect banner (toggle network), long-press copy.
- Approval arriving while in a chat: badge on sidebar Inbox row + notification; open inbox sheet; approve/deny.
- Projects list/detail (segmented), Settings (toggle persists), Sign out → Login.
- Connect/Login styling.
- Dynamic Type at XXL and dark mode on each screen.

- [ ] **Step 4: Commit**

```bash
git add mobile/ios/Unnamed/ConnectViewController.swift mobile/ios/Unnamed/LoginViewController.swift
git commit -m "feat(ios): restyle connect/login to match redesign"
```

- [ ] **Step 5: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to decide how to integrate `redesign/ios-app` (PR or merge).

---

## Notes for the Implementer

- **Xcode project membership:** New `.swift` files must belong to the `Unnamed` target. Modern projects with synchronized groups pick them up automatically; if not, add them in Xcode and commit the resulting `project.pbxproj` change.
- **Tasks 4 and 5 are tightly coupled** (the coordinator references `ChatViewController(isNew:)`/`onOpenSidebar`). If building Task 4 alone fails on those symbols, implement Task 5 Steps 1–3 first, then return to Task 4.
- **No automated UI tests exist;** every task's gate is a green `xcodebuild` plus the listed manual Simulator checks. The only pure-logic unit check is `groupChatsByTime` via the `swift` CLI in Task 3.
