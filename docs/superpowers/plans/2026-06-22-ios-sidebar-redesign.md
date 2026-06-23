# iOS Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the iOS sidebar to match the web app's sidebar layout: brand in the nav-bar slot (no close button), inline-expanding search, inbox moved to the top-right, account as a full-width footer row, a 5-item Recent list, and a new full-history Chats screen — with the sidebar acting as the iPhone navigation root.

**Architecture:** `SidebarViewController` is rewritten in place (same class name, same delegate callbacks into `AppCoordinator`, minus `onClose`). A new `ChatsViewController` is added for full date-grouped history, reusing the existing time-grouping helpers. `AppCoordinator` changes how the split view collapses so the sidebar — not the chat — is the front column on iPhone, and `ChatViewController` stops showing its own sidebar-toggle button when collapsed.

**Tech Stack:** UIKit (programmatic, no Storyboards/SwiftUI), `UISplitViewController`, manual Xcode `project.pbxproj` editing (no synchronized-folder support in this project).

## Global Constraints

- No XCTest target exists in this project — verification is `xcodebuild build` (compile-clean) plus manual checks in the iOS Simulator. Do not invent a test target.
- Follow existing code style: doc comments only where a non-obvious WHY exists (see existing `//` comments in `SidebarViewController.swift` and `ChatViewController.swift` for the tone to match).
- Reuse existing helpers — do not duplicate: `AppPalette` (`UIHelpers.swift:12`), `UIFont.app(...)` (`UIHelpers.swift:125,132`), `relativeTime(from:)` (`UIHelpers.swift:94`), `ChatTimeGroup` / `groupChatsByTime` (`UIHelpers.swift:162,176`), `pinToSuperviewEdges()` (`UIHelpers.swift:150`).
- `ChatSession`, `Project`, `UserProfile` types live in `Models.swift`; `APIClient` methods used: `sessions() async throws -> [ChatSession]`, `activeSessions() async throws -> [String]`, `projects() async throws -> [Project]`, `me() async throws -> UserProfile` (`APIClient.swift:35,43,135,150`).
- `ApprovalCenter.shared.count` (`ApprovalCenter.swift:14`) is the live approval badge count; `.approvalCountChanged` notification fires on change.
- Commit after every task.

---

## File Structure

- **Modify** `mobile/ios/Unnamed/SidebarViewController.swift` — brand moves to nav bar, search becomes inline-expanding, inbox bell moves to nav bar, footer account row added, close button removed, Recent capped at 5, "Chats" row added.
- **Create** `mobile/ios/Unnamed/ChatsViewController.swift` — full date-grouped, searchable chat history, pushed from the sidebar's "Chats" row.
- **Modify** `mobile/ios/Unnamed/ChatViewController.swift` — suppress the `sidebar.left` button when the split view is collapsed.
- **Modify** `mobile/ios/Unnamed/AppCoordinator.swift` — sidebar becomes the collapsed root; wire the new "Chats" destination; remove `onClose`.
- **Modify** `mobile/ios/Unnamed.xcodeproj/project.pbxproj` — register the new `ChatsViewController.swift` file.

---

### Task 1: Add `ChatsViewController.swift` to the Xcode project

**Files:**
- Create: `mobile/ios/Unnamed/ChatsViewController.swift` (placeholder body for now)
- Modify: `mobile/ios/Unnamed.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: a compiling, empty `ChatsViewController: UIViewController` that later tasks fill in.

- [ ] **Step 1: Create the placeholder file**

```swift
// mobile/ios/Unnamed/ChatsViewController.swift
import UIKit

final class ChatsViewController: UIViewController {
  init() {
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }
}
```

- [ ] **Step 2: Register the file in `project.pbxproj`**

Open `mobile/ios/Unnamed.xcodeproj/project.pbxproj` and make four edits, using these two fresh object IDs:
- Build file ID: `739AF0E0BE024BAEB11F5E2F`
- File reference ID: `9C391D4A3C7347D3A58ADAAA`

1. In the `PBXBuildFile` section, add a line next to the existing `SidebarViewController.swift in Sources` entry (around line 29):

```
		D21F48422D0307B40044C1D9 /* SidebarViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = D21748412D0307B40044C1D9 /* SidebarViewController.swift */; };
		739AF0E0BE024BAEB11F5E2F /* ChatsViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = 9C391D4A3C7347D3A58ADAAA /* ChatsViewController.swift */; };
```

2. In the `PBXFileReference` section, add a line next to the existing `SidebarViewController.swift` entry (around line 55):

```
		D21748412D0307B40044C1D9 /* SidebarViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = SidebarViewController.swift; path = Unnamed/SidebarViewController.swift; sourceTree = "<group>"; };
		9C391D4A3C7347D3A58ADAAA /* ChatsViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = ChatsViewController.swift; path = Unnamed/ChatsViewController.swift; sourceTree = "<group>"; };
```

3. In the group's children list, add a line next to the `SidebarViewController.swift` group entry (around line 89):

```
				D21748412D0307B40044C1D9 /* SidebarViewController.swift */,
				9C391D4A3C7347D3A58ADAAA /* ChatsViewController.swift */,
```

4. In the `PBXSourcesBuildPhase` `files` list, add a line next to the `SidebarViewController.swift in Sources` entry (around line 220):

```
				D21F48422D0307B40044C1D9 /* SidebarViewController.swift in Sources */,
				739AF0E0BE024BAEB11F5E2F /* ChatsViewController.swift in Sources */,
```

- [ ] **Step 3: Build to verify the project registers and compiles the new file**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -30`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add mobile/ios/Unnamed/ChatsViewController.swift mobile/ios/Unnamed.xcodeproj/project.pbxproj
git commit -m "feat(ios): add empty ChatsViewController scaffold"
```

---

### Task 2: Build `ChatsViewController` — full date-grouped, searchable history

**Files:**
- Modify: `mobile/ios/Unnamed/ChatsViewController.swift`

**Interfaces:**
- Consumes: `AppSession` (init param, same as `SidebarViewController`), `APIClient(session:)`, `client.sessions() async throws -> [ChatSession]`, `client.activeSessions() async throws -> [String]`, `client.projects() async throws -> [Project]`, `groupChatsByTime(_:) -> [(group: ChatTimeGroup, chats: [ChatSession])]`, `relativeTime(from:) -> String`, `ChatSession.pinnedProjectId`, `ChatSession.updatedAt`, `ChatSession.title`, `Project.id`, `Project.name`.
- Produces: `init(appSession: AppSession)`; `var onSelectChat: ((ChatSession) -> Void)?` callback used by `AppCoordinator` to open a chat.

- [ ] **Step 1: Replace the placeholder with the full implementation**

```swift
// mobile/ios/Unnamed/ChatsViewController.swift
import UIKit

/// Full chat history, date-grouped and searchable — the destination for the
/// sidebar's "Chats" row, since the sidebar itself only shows a 5-item Recent list.
final class ChatsViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var groupedChats: [(group: ChatTimeGroup, chats: [ChatSession])] = []
  private var projectsById: [String: Project] = [:]
  private var activeIds: Set<String> = []
  private var filter = ""

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let searchController = UISearchController(searchResultsController: nil)

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    title = "Chats"

    searchController.searchResultsUpdater = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    navigationItem.searchController = searchController
    navigationItem.hidesSearchBarWhenScrolling = false

    tableView.backgroundColor = .systemBackground
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    view.addSubview(tableView)
    tableView.pinToSuperviewEdges()

    reload()
  }

  private func reload() {
    Task {
      async let sessions = client.sessions()
      async let active = client.activeSessions()
      async let allProjects = try? client.projects()
      if let chats = try? await sessions {
        allChats = chats
      }
      activeIds = Set((try? await active) ?? [])
      if let projects = await allProjects {
        projectsById = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
      }
      applyFilterAndRender()
    }
  }

  private func applyFilterAndRender() {
    let filteredChats = filter.isEmpty
      ? allChats
      : allChats.filter { ($0.title ?? "").localizedCaseInsensitiveContains(filter) }
    groupedChats = groupChatsByTime(filteredChats)
    tableView.reloadData()
  }
}

extension ChatsViewController: UISearchResultsUpdating {
  func updateSearchResults(for searchController: UISearchController) {
    filter = searchController.searchBar.text ?? ""
    applyFilterAndRender()
  }
}

extension ChatsViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { groupedChats.count }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    groupedChats[section].chats.count
  }
  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    groupedChats[section].group.label
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
    let chat = groupedChats[indexPath.section].chats[indexPath.row]
    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled chat"
    content.textProperties.font = .app(ofSize: 14, weight: .medium)
    content.textProperties.numberOfLines = 1
    var meta = chat.updatedAt.map { relativeTime(from: $0) } ?? ""
    if let projectId = chat.pinnedProjectId, let project = projectsById[projectId] {
      meta = meta.isEmpty ? project.name : "\(meta) · \(project.name)"
    }
    content.secondaryText = meta.isEmpty ? nil : meta
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    cell.contentConfiguration = content
    cell.accessoryView = nil
    if activeIds.contains(chat.id) {
      let dot = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 8))
      dot.backgroundColor = .systemGreen
      dot.layer.cornerRadius = 4
      cell.accessoryView = dot
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectChat?(groupedChats[indexPath.section].chats[indexPath.row])
  }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -30`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/ChatsViewController.swift
git commit -m "feat(ios): implement ChatsViewController full-history list"
```

---

### Task 3: Rewrite `SidebarViewController` — brand in nav slot, inline search, footer account, Recent-5, no close button

**Files:**
- Modify: `mobile/ios/Unnamed/SidebarViewController.swift`

**Interfaces:**
- Consumes: same as before (`AppSession`, `APIClient`), plus `ApprovalCenter.shared.count`, `.approvalCountChanged` notification.
- Produces (callbacks set by `AppCoordinator`):
  - `var onSelectChat: ((ChatSession) -> Void)?`
  - `var onNewChat: (() -> Void)?`
  - `var onShowProjects: (() -> Void)?`
  - `var onShowChats: (() -> Void)?` — **new**, opens `ChatsViewController`.
  - `var onShowInbox: (() -> Void)?`
  - `var onShowSettings: (() -> Void)?`
  - `func reload()` — unchanged public entry point called by `AppCoordinator`.
  - **Removed:** `var onClose: (() -> Void)?` and all close-button code.

This task replaces the file's full contents. The row model drops `.inbox` (inbox is now a nav-bar bell, not a row) and adds `.chats`; the chat-grouping helper drops to a flat top-5 "Recent" list instead of full date grouping (full grouping now lives in `ChatsViewController`, Task 2).

- [ ] **Step 1: Replace the full file contents**

```swift
// mobile/ios/Unnamed/SidebarViewController.swift
import UIKit

/// A row in the sidebar's single table: either one of the two static
/// quick-access rows up top, or a chat in the "Recent" section below. Kept as
/// one enum so the table's data source stays a flat, section-indexed lookup
/// rather than juggling two parallel models.
private enum SidebarRow {
  case chats
  case projects
  case chat(ChatSession)
}

private let recentLimit = 5

/// Styled to read as the same product as the web app's sidebar (flat list,
/// brand in the nav bar, pill "New chat" button, full-width footer account
/// row) rather than a native iOS Settings-style grouped list. The sidebar is
/// the navigation root on iPhone — there is no close button, only the system
/// back chevron from a pushed chat.
final class SidebarViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?
  var onNewChat: (() -> Void)?
  var onShowProjects: (() -> Void)?
  var onShowChats: (() -> Void)?
  var onShowInbox: (() -> Void)?
  var onShowSettings: (() -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var recentChats: [ChatSession] = []
  private var searchResults: [ChatSession] = []
  private var projectsById: [String: Project] = [:]
  private var activeIds: Set<String> = []
  private var filter = ""
  private var email = "—"

  private var sections: [[SidebarRow]] = []

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let searchController = UISearchController(searchResultsController: nil)
  private let footer = SidebarFooterView()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    navigationItem.largeTitleDisplayMode = .never
    hideNavBarHairline()
    navigationItem.leftBarButtonItem = UIBarButtonItem(customView: makeBrandView())

    searchController.searchResultsUpdater = self
    searchController.delegate = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    let searchItem = UIBarButtonItem(image: UIImage(systemName: "magnifyingglass"), style: .plain, target: self, action: #selector(searchTapped))
    searchItem.accessibilityLabel = "Search"
    navigationItem.rightBarButtonItems = [makeInboxButton(), searchItem]

    setupTable()
    setupFooter()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    navigationController?.setToolbarHidden(true, animated: animated)
  }

  // MARK: - Brand (top-left nav slot, replaces the old header block + close button)

  private func makeBrandView() -> UIView {
    let mark = UILabel()
    mark.text = "u"
    mark.textColor = AppPalette.accentForeground
    mark.font = .app(ofSize: 13, weight: .semibold)
    mark.textAlignment = .center
    mark.backgroundColor = AppPalette.accent
    mark.layer.cornerRadius = 7
    mark.clipsToBounds = true
    mark.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      mark.widthAnchor.constraint(equalToConstant: 24),
      mark.heightAnchor.constraint(equalToConstant: 24),
    ])

    let name = UILabel()
    name.text = "unnamed"
    name.font = .app(ofSize: 15, weight: .semibold)
    name.textColor = .label

    let row = UIStackView(arrangedSubviews: [mark, name])
    row.axis = .horizontal
    row.spacing = 8
    row.alignment = .center
    return row
  }

  // MARK: - Inbox bell (top-right nav bar)

  private func makeInboxButton() -> UIBarButtonItem {
    let item = UIBarButtonItem(image: UIImage(systemName: "bell"), style: .plain, target: self, action: #selector(inboxTapped))
    item.accessibilityLabel = "Inbox"
    self.inboxBarButton = item
    return item
  }

  private var inboxBarButton: UIBarButtonItem?

  private func updateInboxBadge() {
    let n = ApprovalCenter.shared.count
    inboxBarButton?.image = n > 0
      ? UIImage(systemName: "bell.badge.fill")
      : UIImage(systemName: "bell")
  }

  // MARK: - "New chat" header above the table

  private func makeHeaderView() -> UIView {
    let container = UIView()

    let newChatButton = UIButton(type: .system)
    var config = UIButton.Configuration.filled()
    config.title = "New chat"
    config.image = UIImage(systemName: "plus")
    config.imagePadding = 6
    config.cornerStyle = .large
    config.baseBackgroundColor = AppPalette.accent
    config.baseForegroundColor = AppPalette.accentForeground
    config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var out = incoming
      out.font = .app(ofSize: 14, weight: .medium)
      return out
    }
    newChatButton.configuration = config
    newChatButton.addTarget(self, action: #selector(newChatTapped), for: .touchUpInside)
    newChatButton.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(newChatButton)
    NSLayoutConstraint.activate([
      newChatButton.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
      newChatButton.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
      newChatButton.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
      newChatButton.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
    ])
    return container
  }

  // MARK: - Footer: full-width account row (mirrors web's footer account menu)

  private func setupFooter() {
    footer.onTap = { [weak self] in self?.onShowSettings?() }
    footer.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(footer)
    NSLayoutConstraint.activate([
      footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    NSLayoutConstraint.activate([
      tableView.bottomAnchor.constraint(equalTo: footer.topAnchor),
    ])
  }

  // MARK: - Table

  private func setupTable() {
    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.tableHeaderView = makeHeaderView()
    tableView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(tableView)
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    layoutHeader()
  }

  private func layoutHeader() {
    guard let header = tableView.tableHeaderView else { return }
    let size = header.systemLayoutSizeFitting(CGSize(width: view.bounds.width, height: .greatestFiniteMagnitude))
    if header.frame.height != size.height {
      header.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: size.height)
      tableView.tableHeaderView = header
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    layoutHeader()
  }

  // MARK: - Data

  func reload() {
    Task {
      async let sessions = client.sessions()
      async let active = client.activeSessions()
      async let allProjects = try? client.projects()
      async let profile = try? client.me()
      if let chats = try? await sessions {
        allChats = chats
      }
      activeIds = Set((try? await active) ?? [])
      if let projects = await allProjects {
        projectsById = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
      }
      if let p = await profile {
        email = p.email
        appSession.setCachedEmail(p.email)
      }
      applyFilterAndRender()
    }
  }

  private var isSearching: Bool { !filter.isEmpty }

  private func applyFilterAndRender() {
    if isSearching {
      searchResults = allChats.filter { ($0.title ?? "").localizedCaseInsensitiveContains(filter) }
    } else {
      recentChats = Array(allChats.prefix(recentLimit))
    }

    footer.configure(email: email)
    updateInboxBadge()

    var newSections: [[SidebarRow]] = []
    if isSearching {
      newSections.append(searchResults.map { SidebarRow.chat($0) })
    } else {
      newSections.append([.chats, .projects])
      newSections.append(recentChats.map { SidebarRow.chat($0) })
    }
    sections = newSections
    tableView.reloadData()
  }

  @objc private func newChatTapped() { onNewChat?() }
  @objc private func inboxTapped() { onShowInbox?() }
  @objc private func searchTapped() {
    navigationItem.searchController = searchController
    searchController.isActive = true
  }
  @objc private func approvalCountChanged() { updateInboxBadge() }
}

extension SidebarViewController: UISearchResultsUpdating {
  func updateSearchResults(for searchController: UISearchController) {
    filter = searchController.searchBar.text ?? ""
    applyFilterAndRender()
  }
}

extension SidebarViewController: UISearchControllerDelegate {
  func didDismissSearchController(_ searchController: UISearchController) {
    navigationItem.searchController = nil
    filter = ""
    applyFilterAndRender()
  }
}

extension SidebarViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { sections.count }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].count }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    guard !isSearching, section == 1, !sections[section].isEmpty else { return nil }
    return "Recent"
  }

  func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
    guard let header = view as? UITableViewHeaderFooterView else { return }
    header.textLabel?.font = .app(ofSize: 12, weight: .semibold)
    header.textLabel?.textColor = .secondaryLabel
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.textProperties.font = .app(ofSize: 14, weight: .medium)
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    cell.accessoryView = nil
    cell.accessoryType = .none
    cell.selectionStyle = .default
    cell.backgroundColor = .clear

    switch sections[indexPath.section][indexPath.row] {
    case .chats:
      content.text = "Chats"
      content.image = UIImage(systemName: "bubble.left.and.bubble.right")
      content.imageProperties.tintColor = .secondaryLabel
    case .projects:
      content.text = "Projects"
      content.image = UIImage(systemName: "square.grid.2x2")
      content.imageProperties.tintColor = .secondaryLabel
    case .chat(let chat):
      content.text = chat.title ?? "Untitled chat"
      content.textProperties.numberOfLines = 1
      var meta = chat.updatedAt.map { relativeTime(from: $0) } ?? ""
      if let projectId = chat.pinnedProjectId, let project = projectsById[projectId] {
        meta = meta.isEmpty ? project.name : "\(meta) · \(project.name)"
      }
      content.secondaryText = meta.isEmpty ? nil : meta
      if activeIds.contains(chat.id) {
        let dot = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 8))
        dot.backgroundColor = .systemGreen
        dot.layer.cornerRadius = 4
        cell.accessoryView = dot
      }
    }

    cell.contentConfiguration = content
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    switch sections[indexPath.section][indexPath.row] {
    case .chats: onShowChats?()
    case .projects: onShowProjects?()
    case .chat(let chat): onSelectChat?(chat)
    }
  }
}

/// Full-width footer row mirroring web's bottom account menu: avatar + email,
/// tappable to open Settings. Pinned to the view's bottom, no divider above it.
private final class SidebarFooterView: UIView {
  var onTap: (() -> Void)?

  private let avatar = UILabel()
  private let label = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground

    avatar.backgroundColor = .tintColor
    avatar.textColor = .white
    avatar.font = .app(ofSize: 13, weight: .semibold)
    avatar.textAlignment = .center
    avatar.layer.cornerRadius = 14
    avatar.clipsToBounds = true
    avatar.translatesAutoresizingMaskIntoConstraints = false

    label.font = .app(ofSize: 14, weight: .medium)
    label.textColor = .label

    let row = UIStackView(arrangedSubviews: [avatar, label])
    row.axis = .horizontal
    row.spacing = 10
    row.alignment = .center
    row.translatesAutoresizingMaskIntoConstraints = false
    addSubview(row)
    NSLayoutConstraint.activate([
      avatar.widthAnchor.constraint(equalToConstant: 28),
      avatar.heightAnchor.constraint(equalToConstant: 28),
      row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
      row.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -16),
      row.topAnchor.constraint(equalTo: topAnchor, constant: 10),
      row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
    ])

    isUserInteractionEnabled = true
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
  }
  required init?(coder: NSCoder) { fatalError() }

  func configure(email: String) {
    avatar.text = email.first.map { String($0).uppercased() } ?? "•"
    label.text = email
  }

  @objc private func tapped() { onTap?() }
}
```

- [ ] **Step 2: Build to verify it compiles**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -40`
Expected: build errors referencing `AppCoordinator.swift` (it still calls the now-removed `onClose` and `onShowInbox` wiring needs `onShowChats`) — this is expected since Task 4 fixes the call site. Confirm the *only* errors are in `AppCoordinator.swift`, not in `SidebarViewController.swift` itself.

- [ ] **Step 3: Commit**

```bash
git add mobile/ios/Unnamed/SidebarViewController.swift
git commit -m "feat(ios): redesign sidebar to match web (brand in nav bar, inline search, footer account, Recent-5)"
```

---

### Task 4: Wire `AppCoordinator` — sidebar as collapsed root, new Chats destination, drop `onClose`

**Files:**
- Modify: `mobile/ios/Unnamed/AppCoordinator.swift`

**Interfaces:**
- Consumes: `SidebarViewController.onShowChats`, `ChatsViewController(appSession:)`, `ChatsViewController.onSelectChat`.
- Produces: `showHome()` now sets up the split view so the **sidebar** is the collapsed-mode front column instead of the chat.

- [ ] **Step 1: Update `makeSidebar()` — remove `onClose`, add `onShowChats`**

In `mobile/ios/Unnamed/AppCoordinator.swift`, replace:

```swift
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
```

with:

```swift
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
  /// Projects/Settings which live in the chat-area stack).
  private func showChats() {
    let controller = ChatsViewController(appSession: session)
    controller.onSelectChat = { [weak self] chat in self?.openChat(chat) }
    sidebarNav?.pushViewController(controller, animated: true)
  }
```

- [ ] **Step 2: Track the sidebar's own nav controller**

Add a new property next to `mainNav` (around line 11):

```swift
  private var mainNav: UINavigationController?
  private var sidebarNav: UINavigationController?
```

- [ ] **Step 3: Make the sidebar the collapsed-mode front column**

Replace `showHome()`'s split-view setup. Find:

```swift
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
```

Replace with:

```swift
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
```

- [ ] **Step 4: Make `AppCoordinator` conform to `UISplitViewControllerDelegate` to pin the primary column as the collapsed front**

Add at the bottom of the file, outside the class:

```swift
extension AppCoordinator: UISplitViewControllerDelegate {
  /// On iPhone the split view collapses to a single stack. Returning `.primary`
  /// here keeps the sidebar as that stack's root instead of the chat.
  func splitViewController(_ splitViewController: UISplitViewController, topColumnForCollapsingToProposedTopColumn proposedTopColumn: UISplitViewController.Column) -> UISplitViewController.Column {
    .primary
  }
}
```

- [ ] **Step 5: Remove the now-dead `toggleSidebar` close-path comment reference (no functional change needed — `toggleSidebar` itself still works for iPad)**

No code change required here; `toggleSidebar()` (used by `ChatViewController.onOpenSidebar`) is iPad-only behavior now per Task 5 and is left as-is.

- [ ] **Step 6: Build to verify it compiles clean**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -40`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 7: Commit**

```bash
git add mobile/ios/Unnamed/AppCoordinator.swift
git commit -m "feat(ios): make sidebar the collapsed navigation root, wire Chats destination"
```

---

### Task 5: Suppress `ChatViewController`'s sidebar-toggle button when collapsed

**Files:**
- Modify: `mobile/ios/Unnamed/ChatViewController.swift:101-104`

**Interfaces:**
- Consumes: `splitViewController?.isCollapsed` (standard UIKit property, available via `UIViewController`).

On iPhone, the chat screen is now pushed *onto* the sidebar's own nav stack, so the system back chevron already returns to the sidebar — the custom `sidebar.left` button would be redundant. On iPad it remains, toggling the persistent column.

- [ ] **Step 1: Make the left bar button conditional on split state**

Replace:

```swift
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "sidebar.left"),
      style: .plain, target: self, action: #selector(openSidebarTapped))
    navigationItem.leftBarButtonItem?.tintColor = AppPalette.accent
```

with:

```swift
    updateSidebarButtonVisibility()
```

Add a new method near `viewWillAppear` (find the existing `override func viewDidLoad()` block boundary and add after it, or alongside other overrides):

```swift
  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    updateSidebarButtonVisibility()
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    updateSidebarButtonVisibility()
  }

  /// On iPhone (collapsed split view) the chat is pushed onto the sidebar's own
  /// stack, so the system back chevron already returns to the sidebar — the
  /// custom toggle button would be redundant. On iPad (expanded) it remains,
  /// to open/close the persistent sidebar column.
  private func updateSidebarButtonVisibility() {
    guard splitViewController?.isCollapsed == false else {
      navigationItem.leftBarButtonItem = nil
      return
    }
    let button = UIBarButtonItem(
      image: UIImage(systemName: "sidebar.left"),
      style: .plain, target: self, action: #selector(openSidebarTapped))
    button.tintColor = AppPalette.accent
    navigationItem.leftBarButtonItem = button
  }
```

If `viewWillAppear` or `traitCollectionDidChange` already exist elsewhere in the file, merge these bodies into the existing overrides instead of duplicating the method signature (check with `grep -n "func viewWillAppear\|func traitCollectionDidChange" mobile/ios/Unnamed/ChatViewController.swift` before editing).

- [ ] **Step 2: Verify no duplicate overrides**

Run: `grep -n "func viewWillAppear\|func traitCollectionDidChange\|func updateSidebarButtonVisibility" mobile/ios/Unnamed/ChatViewController.swift`
Expected: each override appears exactly once.

- [ ] **Step 3: Build to verify it compiles**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -40`
Expected: `** BUILD SUCCEEDED **`

- [ ] **Step 4: Commit**

```bash
git add mobile/ios/Unnamed/ChatViewController.swift
git commit -m "fix(ios): hide chat's sidebar toggle when split view is collapsed"
```

---

### Task 6: Manual verification in the Simulator

**Files:** none (manual QA pass — no source changes)

- [ ] **Step 1: Boot the simulator and install the app**

Run: `cd mobile/ios && xcodebuild -workspace Unnamed.xcworkspace -scheme Unnamed -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build 2>&1 | tail -10`
Then run the app from Xcode or via `xcrun simctl install`/`launch` against the booted `iPhone 17 Pro` simulator (UDID `671A5BCB-2E21-4073-8B43-CB2454E126B5` from `xcrun simctl list devices available`).

- [ ] **Step 2: Walk the iPhone golden path**

Check each:
- App launches directly onto the **sidebar** (brand `u unnamed` top-left, no X anywhere).
- No hairline divider under the nav bar or above the footer.
- Tapping 🔍 expands a search field over the brand line with a Cancel control; typing filters the list; Cancel collapses back.
- 🔔 sits top-right next to search; switches to a filled/badged glyph when `ApprovalCenter.shared.count > 0` (trigger via an existing pending approval if available, or temporarily set `ApprovalCenter.shared.setCount(1)` in the debugger to confirm).
- "Chats" row pushes `ChatsViewController` showing full date-grouped history; back returns to the sidebar.
- "Projects" row still pushes Projects as before.
- "Recent" shows at most 5 items, most-recent first, no "See all" link.
- Footer shows avatar + email full-width at the bottom, tap opens Settings.
- Selecting a chat pushes it on top of the sidebar; back chevron returns to the sidebar (not to a blank chat).
- New chat button still creates and opens a new chat.

- [ ] **Step 3: Walk the iPad split-view path**

On an iPad simulator (e.g. `xcrun simctl list devicetypes | grep iPad` to pick one, boot it, rebuild for that destination):
- Sidebar persists as a column beside chat at launch.
- Chat screen's `sidebar.left` button still toggles the column open/closed.
- All sidebar content (brand, search, inbox, footer, Recent, Chats/Projects rows) renders the same as iPhone.

- [ ] **Step 4: Fix any issues found, otherwise proceed**

If a check fails, fix the relevant task's file directly, rebuild, and re-test before moving on. No commit needed for this task unless a fix was required (then commit the fix with a `fix(ios): ...` message).

---

## Self-Review Notes

- **Spec coverage:** brand→nav slot ✅(Task 3), no X/root nav ✅(Tasks 3,4), no hairlines ✅(Task 3 `hideNavBarHairline()` + no divider constraints), inbox→nav bar ✅(Task 3), account→footer row ✅(Task 3 `SidebarFooterView`), inline search ✅(Task 3), Recent-5 no "See all" ✅(Task 3 `recentLimit`), Chats screen ✅(Task 2), sidebar-root nav model ✅(Task 4 delegate + `show(.primary)`), iPad unchanged toggle ✅(Task 5).
- **Placeholder scan:** none found — every step has complete code or an exact command with expected output.
- **Type consistency:** `SidebarRow` cases (`.chats`, `.projects`, `.chat`) match between declaration and switch statements; `onShowChats`/`onSelectChat`/`onShowProjects`/`onShowInbox`/`onShowSettings` callback names match between `SidebarViewController` (Task 3) and `AppCoordinator` (Task 4); `ChatsViewController(appSession:)` and `.onSelectChat` match between Task 2 and Task 4.
