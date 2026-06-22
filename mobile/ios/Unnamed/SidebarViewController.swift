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
    removeNavBarBackground()
    navigationItem.leftBarButtonItem = UIBarButtonItem(customView: makeBrandView())

    searchController.searchResultsUpdater = self
    searchController.delegate = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    if #available(iOS 26.0, *) {
      navigationItem.searchController = searchController
      navigationItem.preferredSearchBarPlacement = .integratedButton
      navigationItem.searchBarPlacementAllowsToolbarIntegration = false
      navigationItem.rightBarButtonItems = [makeInboxButton()]
    } else {
      // On older iOS, attach the search controller on demand via a button so the
      // bar doesn't permanently occupy the nav area on short lists where
      // hidesSearchBarWhenScrolling can never hide it.
      let searchItem = UIBarButtonItem(image: UIImage(systemName: "magnifyingglass"), style: .plain, target: self, action: #selector(searchTapped))
      searchItem.accessibilityLabel = "Search"
      navigationItem.rightBarButtonItems = [makeInboxButton(), searchItem]
    }

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
    let name = UILabel()
    name.text = "unnamed"
    name.font = .app(ofSize: 17, weight: .semibold)
    name.textColor = .label
    return name
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
    var config = UIButton.Configuration.borderedProminent()
    config.title = "New chat"
    config.image = UIImage(systemName: "plus")
    config.imagePadding = 6
    config.cornerStyle = .capsule
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
  @objc private func approvalCountChanged() { updateInboxBadge() }

  @objc private func searchTapped() {
    navigationItem.searchController = searchController
    searchController.isActive = true
  }
}

extension SidebarViewController: UISearchResultsUpdating {
  func updateSearchResults(for searchController: UISearchController) {
    filter = searchController.searchBar.text ?? ""
    applyFilterAndRender()
  }
}

extension SidebarViewController: UISearchControllerDelegate {
  func didDismissSearchController(_ searchController: UISearchController) {
    if #unavailable(iOS 26.0) {
      navigationItem.searchController = nil
    }
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

/// Full-width native account row pinned to the bottom, opening Settings.
private final class SidebarFooterView: UIControl {
  var onTap: (() -> Void)?

  private let contentView = UIListContentView(configuration: UIListContentConfiguration.cell())
  private let chevronView = UIImageView(image: UIImage(systemName: "chevron.right"))

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    accessibilityTraits = [.button]
    addTarget(self, action: #selector(tapped), for: .touchUpInside)

    contentView.translatesAutoresizingMaskIntoConstraints = false
    contentView.isUserInteractionEnabled = false
    addSubview(contentView)

    chevronView.tintColor = .tertiaryLabel
    chevronView.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .semibold)
    chevronView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(chevronView)

    NSLayoutConstraint.activate([
      contentView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
      contentView.trailingAnchor.constraint(equalTo: chevronView.leadingAnchor, constant: -8),
      contentView.topAnchor.constraint(equalTo: topAnchor, constant: 8),
      contentView.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
      chevronView.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      chevronView.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -20),
    ])
    configure(email: "—")
  }
  required init?(coder: NSCoder) { fatalError() }

  override var isHighlighted: Bool {
    didSet {
      UIView.animate(withDuration: 0.12) {
        self.contentView.alpha = self.isHighlighted ? 0.55 : 1
        self.chevronView.alpha = self.isHighlighted ? 0.55 : 1
      }
    }
  }

  func configure(email: String) {
    var config = UIListContentConfiguration.subtitleCell()
    config.text = email
    config.secondaryText = "Settings"
    config.image = UIImage(systemName: "person.crop.circle.fill")
    config.imageProperties.tintColor = AppPalette.accent
    config.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 28, weight: .regular)
    config.textProperties.font = .app(ofSize: 15, weight: .medium)
    config.secondaryTextProperties.font = .app(ofSize: 12, weight: .regular)
    config.secondaryTextProperties.color = .secondaryLabel
    config.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0)
    contentView.configuration = config
    accessibilityLabel = "Settings, \(email)"
  }

  @objc private func tapped() { onTap?() }
}
