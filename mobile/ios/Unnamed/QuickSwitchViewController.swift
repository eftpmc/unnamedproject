import UIKit

/// Cmd+K equivalent: fuzzy search over chats and projects, plus quick actions.
/// Presented as a sheet from the chat ellipsis menu so you can jump without
/// leaving the current chat.
final class QuickSwitchViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?
  var onNewChat: (() -> Void)?
  var onShowSettings: (() -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var allProjects: [Project] = []
  private var query = ""

  private let searchBar = UISearchBar()
  private let tableView = UITableView(frame: .zero, style: .plain)

  private enum Row {
    case action(title: String, icon: String, handler: () -> Void)
    case chat(ChatSession)
    case project(Project)
  }
  private var rows: [Row] = []

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    searchBar.placeholder = "Search chats, projects, actions…"
    searchBar.searchBarStyle = .minimal
    searchBar.delegate = self
    searchBar.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(searchBar)

    let sep = UIView()
    sep.backgroundColor = AppPalette.borderSoft
    sep.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(sep)

    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.keyboardDismissMode = .onDrag
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "row")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(tableView)

    NSLayoutConstraint.activate([
      searchBar.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
      searchBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
      searchBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
      sep.topAnchor.constraint(equalTo: searchBar.bottomAnchor),
      sep.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      sep.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      sep.heightAnchor.constraint(equalToConstant: 0.5),
      tableView.topAnchor.constraint(equalTo: sep.bottomAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    reload()
    applyFilter()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    searchBar.becomeFirstResponder()
  }

  private func reload() {
    Task {
      async let chats = try? client.sessions()
      async let projects = try? client.projects()
      allChats = await chats ?? []
      allProjects = await projects ?? []
      applyFilter()
    }
  }

  private func applyFilter() {
    let q = query.lowercased().trimmingCharacters(in: .whitespaces)

    var result: [Row] = []

    // Quick actions — always show when query matches or is empty
    let actions: [(String, String, () -> Void)] = [
      ("New Chat", "square.and.pencil", { [weak self] in self?.dismiss(animated: true) { self?.onNewChat?() } }),
      ("Settings", "gearshape", { [weak self] in self?.dismiss(animated: true) { self?.onShowSettings?() } }),
    ]
    for (title, icon, handler) in actions where q.isEmpty || fuzzyMatch(q, in: title.lowercased()) {
      result.append(.action(title: title, icon: icon, handler: handler))
    }

    // Chats
    let matchedChats = allChats
      .filter { q.isEmpty || fuzzyMatch(q, in: ($0.title ?? "untitled chat").lowercased()) }
      .prefix(8)
    result.append(contentsOf: matchedChats.map { .chat($0) })

    // Projects
    let matchedProjects = allProjects
      .filter { q.isEmpty || fuzzyMatch(q, in: $0.name.lowercased()) }
      .prefix(5)
    result.append(contentsOf: matchedProjects.map { .project($0) })

    rows = result
    tableView.reloadData()
  }

  private func fuzzyMatch(_ query: String, in text: String) -> Bool {
    var qi = text.startIndex
    for ch in query {
      guard let found = text[qi...].firstIndex(of: ch) else { return false }
      qi = text.index(after: found)
    }
    return true
  }
}

extension QuickSwitchViewController: UISearchBarDelegate {
  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    query = searchText
    applyFilter()
  }
  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchBar.resignFirstResponder()
  }
}

extension QuickSwitchViewController: UITableViewDataSource, UITableViewDelegate {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "row", for: indexPath)
    var content = cell.defaultContentConfiguration()
    content.textProperties.font = .app(ofSize: 14, weight: .medium)
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    cell.backgroundColor = .clear

    switch rows[indexPath.row] {
    case .action(let title, let icon, _):
      content.text = title
      content.image = UIImage(systemName: icon)
      content.imageProperties.tintColor = AppPalette.accent
      cell.accessoryType = .none
    case .chat(let chat):
      content.text = chat.title ?? "Untitled chat"
      content.secondaryText = chat.updatedAt.map { relativeTime(from: $0) }
      content.image = UIImage(systemName: "bubble.left.and.bubble.right")
      content.imageProperties.tintColor = .secondaryLabel
      cell.accessoryType = .disclosureIndicator
    case .project(let project):
      content.text = project.name
      content.secondaryText = "Project"
      content.image = UIImage(systemName: "folder")
      content.imageProperties.tintColor = .secondaryLabel
      cell.accessoryType = .disclosureIndicator
    }

    cell.contentConfiguration = content
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    switch rows[indexPath.row] {
    case .action(_, _, let handler):
      handler()
    case .chat(let chat):
      dismiss(animated: true) { [weak self] in self?.onSelectChat?(chat) }
    case .project:
      break
    }
  }
}
