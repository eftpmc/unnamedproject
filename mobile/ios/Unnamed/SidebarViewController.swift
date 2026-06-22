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
  private var activeIds: Set<String> = []
  private var filter = ""
  private var email = "—"

  private var sections: [[SidebarRow]] = []

  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
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
    title = "Chats"
    navigationItem.largeTitleDisplayMode = .always
    navigationController?.navigationBar.prefersLargeTitles = true

    // Full-width drawer has no scrim to tap away, so give it an explicit
    // dismiss affordance (leading close, native full-screen pattern).
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "xmark"),
      style: .plain, target: self, action: #selector(closeTapped))
    navigationItem.rightBarButtonItem = makeAccountButton()

    searchController.searchResultsUpdater = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    navigationItem.searchController = searchController
    navigationItem.hidesSearchBarWhenScrolling = true

    setupTable()
    setupNewChatButton()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  // MARK: - Account button (replaces the old tappable avatar row)

  private func makeAccountButton() -> UIBarButtonItem {
    let avatar = UILabel()
    avatar.backgroundColor = .tintColor
    avatar.textColor = .white
    avatar.font = .systemFont(ofSize: 13, weight: .semibold)
    avatar.textAlignment = .center
    avatar.text = "•"
    avatar.layer.cornerRadius = 14
    avatar.clipsToBounds = true
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.widthAnchor.constraint(equalToConstant: 28).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 28).isActive = true
    self.avatarLabel = avatar

    let button = UIButton(type: .system)
    button.addSubview(avatar)
    avatar.pinToSuperviewEdges()
    button.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)
    button.accessibilityLabel = "Settings"
    return UIBarButtonItem(customView: button)
  }

  private var avatarLabel: UILabel?

  // MARK: - Table

  private func setupTable() {
    tableView.backgroundColor = .systemBackground
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 76, right: 0)
    view.addSubview(tableView)
    tableView.pinToSuperviewEdges()
  }

  // MARK: - Floating "New chat" pill

  private func setupNewChatButton() {
    let button = UIButton(type: .system)
    var config = UIButton.Configuration.filled()
    config.title = "New chat"
    config.image = UIImage(systemName: "plus")
    config.imagePadding = 6
    config.cornerStyle = .capsule
    config.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 20, bottom: 12, trailing: 20)
    button.configuration = config
    button.addTarget(self, action: #selector(newChatTapped), for: .touchUpInside)
    button.layer.shadowColor = UIColor.black.cgColor
    button.layer.shadowOpacity = 0.15
    button.layer.shadowRadius = 8
    button.layer.shadowOffset = CGSize(width: 0, height: 2)

    view.addSubview(button)
    button.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
    ])
  }

  // MARK: - Data

  func reload() {
    Task {
      async let sessions = client.sessions()
      async let active = client.activeSessions()
      async let profile = try? client.me()
      if let chats = try? await sessions {
        allChats = chats
      }
      activeIds = Set((try? await active) ?? [])
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
  @objc private func closeTapped() { onClose?() }
  @objc private func approvalCountChanged() { applyFilterAndRender() }
}

extension SidebarViewController: UISearchResultsUpdating {
  func updateSearchResults(for searchController: UISearchController) {
    filter = searchController.searchBar.text ?? ""
    applyFilterAndRender()
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

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
    var content = cell.defaultContentConfiguration()
    cell.accessoryView = nil

    switch sections[indexPath.section][indexPath.row] {
    case .projects:
      content.text = "Projects"
      content.image = UIImage(systemName: "folder")
      cell.accessoryType = .disclosureIndicator
    case .inbox:
      content.text = "Inbox"
      content.image = UIImage(systemName: "tray")
      let n = ApprovalCenter.shared.count
      if n > 0 {
        content.secondaryText = "\(min(n, 99))"
        content.secondaryTextProperties.color = .systemOrange
        content.secondaryTextProperties.font = .systemFont(ofSize: 15, weight: .semibold)
      }
      cell.accessoryType = .disclosureIndicator
    case .chat(let chat):
      content.text = chat.title ?? "Untitled chat"
      content.textProperties.numberOfLines = 1
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
