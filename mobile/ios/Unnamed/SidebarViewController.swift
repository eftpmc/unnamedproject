// mobile/ios/Unnamed/SidebarViewController.swift
import UIKit

/// A row in the sidebar's single table: either one of the two static
/// quick-access rows up top, or a chat in one of the date-grouped sections
/// below. Kept as one enum so the table's data source stays a flat,
/// section-indexed lookup rather than juggling two parallel models.
private enum SidebarRow {
  case projects
  case inbox
  case chat(ChatSession)
}

/// Styled to read as the same product as the web app's sidebar (flat list,
/// brand header, pill "New chat" button, footer account row) rather than a
/// native iOS Settings-style grouped list.
final class SidebarViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?
  var onNewChat: (() -> Void)?
  var onShowProjects: (() -> Void)?
  var onShowInbox: (() -> Void)?
  var onShowSettings: (() -> Void)?
  var onClose: (() -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var groupedChats: [(group: ChatTimeGroup, chats: [ChatSession])] = []
  private var projectsById: [String: Project] = [:]
  private var activeIds: Set<String> = []
  private var filter = ""
  private var email = "—"

  private var sections: [[SidebarRow]] = []

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let searchController = UISearchController(searchResultsController: nil)

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    navigationItem.title = nil
    navigationItem.largeTitleDisplayMode = .never
    updateCloseButtonVisibility()

    searchController.searchResultsUpdater = self
    searchController.delegate = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    // The search bar is only attached to the nav item while active, so at
    // rest the nav bar shows just the icon button (below) — not the icon
    // *and* a docked search field underneath it.
    navigationItem.hidesSearchBarWhenScrolling = false
    let searchItem = UIBarButtonItem(image: UIImage(systemName: "magnifyingglass"), style: .plain, target: self, action: #selector(searchTapped))
    searchItem.accessibilityLabel = "Search"
    navigationItem.rightBarButtonItems = [makeAccountButton(), searchItem]

    setupTable()
    setupToolbar()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    updateCloseButtonVisibility()
    navigationController?.setToolbarHidden(false, animated: animated)
  }

  override func traitCollectionDidChange(_ previous: UITraitCollection?) {
    super.traitCollectionDidChange(previous)
    updateCloseButtonVisibility()
  }

  private lazy var closeButton = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(closeTapped))

  private func updateCloseButtonVisibility() {
    navigationItem.leftBarButtonItem = (splitViewController?.isCollapsed ?? true) ? closeButton : nil
  }

  // MARK: - Header: brand row + "New chat" button (mirrors web's SidebarHeader)

  private func makeHeaderView() -> UIView {
    let container = UIView()

    let mark = UILabel()
    mark.text = "u"
    mark.textColor = AppPalette.accentForeground
    mark.font = .app(ofSize: 13, weight: .semibold)
    mark.textAlignment = .center
    mark.backgroundColor = AppPalette.accent
    mark.layer.cornerRadius = 7
    mark.clipsToBounds = true

    let name = UILabel()
    name.text = "unnamed"
    name.font = .app(ofSize: 14, weight: .semibold)
    name.textColor = .label

    let brandRow = UIStackView(arrangedSubviews: [mark, name])
    brandRow.axis = .horizontal
    brandRow.spacing = 8
    brandRow.alignment = .center

    mark.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      mark.widthAnchor.constraint(equalToConstant: 28),
      mark.heightAnchor.constraint(equalToConstant: 28),
    ])

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

    let stack = UIStackView(arrangedSubviews: [brandRow, newChatButton])
    stack.axis = .vertical
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
      stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
      stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
    ])
    return container
  }

  // MARK: - Account button (top-right, grouped with the search icon)

  private func makeAccountButton() -> UIBarButtonItem {
    let avatar = UILabel()
    avatar.backgroundColor = .tintColor
    avatar.textColor = .white
    avatar.font = .app(ofSize: 13, weight: .semibold)
    avatar.textAlignment = .center
    avatar.text = "•"
    avatar.layer.cornerRadius = 14
    avatar.clipsToBounds = true
    avatar.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      avatar.widthAnchor.constraint(equalToConstant: 28),
      avatar.heightAnchor.constraint(equalToConstant: 28),
    ])
    self.avatarLabel = avatar

    let button = UIButton(type: .system)
    button.addSubview(avatar)
    avatar.pinToSuperviewEdges()
    button.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)
    button.accessibilityLabel = "Settings"
    return UIBarButtonItem(customView: button)
  }

  // MARK: - Toolbar: inbox (native sidebar-footer pattern, as in Notes/Files/Reminders)

  private func setupToolbar() {
    let inboxButton = UIButton(type: .system)
    inboxButton.setImage(UIImage(systemName: "bell"), for: .normal)
    inboxButton.addTarget(self, action: #selector(inboxTapped), for: .touchUpInside)
    inboxButton.accessibilityLabel = "Inbox"

    let badge = UILabel()
    badge.font = .app(ofSize: 10, weight: .semibold)
    badge.textColor = .white
    badge.backgroundColor = .systemOrange
    badge.textAlignment = .center
    badge.layer.cornerRadius = 7
    badge.clipsToBounds = true
    badge.isHidden = true
    badge.isUserInteractionEnabled = false
    self.inboxBadge = badge

    inboxButton.addSubview(badge)
    badge.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      badge.topAnchor.constraint(equalTo: inboxButton.topAnchor, constant: -4),
      badge.trailingAnchor.constraint(equalTo: inboxButton.trailingAnchor, constant: 4),
      badge.heightAnchor.constraint(equalToConstant: 14),
      badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 14),
    ])

    let inboxItem = UIBarButtonItem(customView: inboxButton)

    toolbarItems = [.flexibleSpace(), inboxItem]
  }

  private var avatarLabel: UILabel?
  private var inboxBadge: UILabel?

  // MARK: - Table

  private func setupTable() {
    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.tableHeaderView = makeHeaderView()
    view.addSubview(tableView)
    tableView.pinToSuperviewEdges()
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
    let filteredChats = filter.isEmpty
      ? allChats
      : allChats.filter { ($0.title ?? "").localizedCaseInsensitiveContains(filter) }
    groupedChats = groupChatsByTime(filteredChats)

    avatarLabel?.text = email.first.map { String($0).uppercased() } ?? "•"

    let n = ApprovalCenter.shared.count
    inboxBadge?.isHidden = n == 0
    inboxBadge?.text = n > 0 ? " \(min(n, 99)) " : nil

    var newSections: [[SidebarRow]] = []
    if !isSearching {
      newSections.append([.projects, .inbox])
    }
    for group in groupedChats {
      newSections.append(group.chats.map { SidebarRow.chat($0) })
    }
    sections = newSections
    tableView.reloadData()
  }

  @objc private func newChatTapped() { onNewChat?() }
  @objc private func settingsTapped() { onShowSettings?() }
  @objc private func inboxTapped() { onShowInbox?() }
  @objc private func searchTapped() {
    navigationItem.searchController = searchController
    searchController.isActive = true
  }
  @objc private func approvalCountChanged() { applyFilterAndRender() }
  @objc private func closeTapped() { onClose?() }
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
  }
}

extension SidebarViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { sections.count }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { sections[section].count }

  private func chatSectionIndex(for section: Int) -> Int? {
    let offset = isSearching ? 0 : 1
    let idx = section - offset
    return idx >= 0 && idx < groupedChats.count ? idx : nil
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    chatSectionIndex(for: section).map { groupedChats[$0].group.label }
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
    case .projects:
      content.text = "Projects"
      content.image = UIImage(systemName: "square.grid.2x2")
      content.imageProperties.tintColor = .secondaryLabel
    case .inbox:
      content.text = "Inbox"
      content.image = UIImage(systemName: "bell")
      content.imageProperties.tintColor = .secondaryLabel
      let n = ApprovalCenter.shared.count
      if n > 0 {
        content.secondaryText = "\(min(n, 99))"
        content.secondaryTextProperties.color = .systemOrange
        content.secondaryTextProperties.font = .app(ofSize: 13, weight: .semibold)
      }
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
    case .projects: onShowProjects?()
    case .inbox: onShowInbox?()
    case .chat(let chat): onSelectChat?(chat)
    }
  }
}
