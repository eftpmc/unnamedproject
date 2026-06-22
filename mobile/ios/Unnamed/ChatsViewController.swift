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
    removeNavBarBackground()

    searchController.searchResultsUpdater = self
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.searchBar.placeholder = "Search chats"
    navigationItem.searchController = searchController
    navigationItem.hidesSearchBarWhenScrolling = false
    if #available(iOS 26.0, *) {
      navigationItem.preferredSearchBarPlacement = .integratedButton
    }

    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

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
