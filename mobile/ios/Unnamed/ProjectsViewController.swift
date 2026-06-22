import UIKit

final class ProjectsViewController: UIViewController {
  var onSelectProject: ((Project) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var projects: [Project] = []
  private var chatCountsByProjectId: [String: Int] = [:]
  private var activeProjectIds: Set<String> = []

  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
  private let refreshControl = UIRefreshControl()
  private let emptyView = UIView()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Projects"
    navigationItem.largeTitleDisplayMode = .never
    view.backgroundColor = .systemBackground
    removeNavBarBackground()

    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.refreshControl = refreshControl
    refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    setupEmptyView()
    load()
  }

  private func setupEmptyView() {
    let icon = UIImageView(image: UIImage(systemName: "folder"))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 38),
      icon.heightAnchor.constraint(equalToConstant: 38),
    ])

    let titleLabel = UILabel()
    titleLabel.text = "No projects"
    titleLabel.font = .app(forTextStyle: .headline)
    titleLabel.textAlignment = .center

    let subtitleLabel = UILabel()
    subtitleLabel.text = "Pinned project workspaces will appear here."
    subtitleLabel.font = .app(forTextStyle: .subheadline)
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.textAlignment = .center
    subtitleLabel.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [icon, titleLabel, subtitleLabel])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 8
    stack.setCustomSpacing(14, after: icon)

    emptyView.isHidden = true
    emptyView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: emptyView.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: emptyView.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: emptyView.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: emptyView.trailingAnchor, constant: -32),
    ])

    view.addSubview(emptyView)
    emptyView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      emptyView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      emptyView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      emptyView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      emptyView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
  }

  @objc private func refreshPulled() { load() }

  private func load() {
    Task {
      do {
        async let loadedProjects = client.projects()
        async let loadedSessions = client.sessions()
        async let activeSessions = client.activeSessions()

        projects = try await loadedProjects
        let sessions = (try? await loadedSessions) ?? []
        let activeIds = Set((try? await activeSessions) ?? [])
        chatCountsByProjectId = Dictionary(grouping: sessions.compactMap(\.pinnedProjectId), by: { $0 })
          .mapValues(\.count)
        activeProjectIds = Set(sessions.compactMap { session in
          activeIds.contains(session.id) ? session.pinnedProjectId : nil
        })
        emptyView.isHidden = !projects.isEmpty
        tableView.reloadData()
      } catch {
        // Keep whatever was already displayed — don't clear projects — but sync
        // the empty-view state so it doesn't contradict the table on first load.
        emptyView.isHidden = !projects.isEmpty
        tableView.reloadData()
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }
}

extension ProjectsViewController: UITableViewDataSource, UITableViewDelegate {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { projects.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    let project = projects[indexPath.row]

    var content = UIListContentConfiguration.subtitleCell()
    content.text = project.name
    content.textProperties.font = .app(ofSize: 15, weight: .medium)
    content.secondaryText = projectSubtitle(project)
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    content.secondaryTextProperties.numberOfLines = 2
    content.image = UIImage(systemName: "folder")
    content.imageProperties.tintColor = activeProjectIds.contains(project.id) ? AppPalette.success : AppPalette.accent
    cell.contentConfiguration = content
    cell.accessoryType = .disclosureIndicator
    cell.backgroundColor = .systemBackground
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectProject?(projects[indexPath.row])
  }

  private func projectSubtitle(_ project: Project) -> String {
    let count = chatCountsByProjectId[project.id] ?? 0
    let chatText = count == 1 ? "1 chat" : "\(count) chats"
    let repo = project.repoPath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "No repo linked"
    return "\(repo) · \(chatText)"
  }
}
