import UIKit

final class ProjectsViewController: UIViewController {
  var onSelectProject: ((Project) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var projects: [Project] = []

  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
  private let refreshControl = UIRefreshControl()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Projects"
    navigationItem.largeTitleDisplayMode = .always
    view.backgroundColor = .systemBackground

    tableView.backgroundColor = .systemBackground
    tableView.separatorInset = UIEdgeInsets(top: 0, left: 56, bottom: 0, right: 0)
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

    load()
  }

  @objc private func refreshPulled() { load() }

  private func load() {
    Task {
      do {
        projects = try await client.projects()
        tableView.reloadData()
      } catch {
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

    var content = cell.defaultContentConfiguration()
    content.text = project.name
    content.secondaryText = project.repoPath ?? "No repo linked"
    content.image = UIImage(systemName: "folder")
    content.imageProperties.tintColor = .systemGreen
    cell.contentConfiguration = content
    cell.accessoryType = .disclosureIndicator
    cell.backgroundColor = .systemBackground
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectProject?(projects[indexPath.row])
  }
}
