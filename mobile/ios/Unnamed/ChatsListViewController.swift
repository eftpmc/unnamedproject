import UIKit

final class ChatsListViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var chats: [ChatSession] = []

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Chats"
    view.backgroundColor = AppTheme.canvas

    tableView.backgroundColor = AppTheme.canvas
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
        chats = try await client.sessions()
        tableView.reloadData()
      } catch {
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }
}

extension ChatsListViewController: UITableViewDataSource, UITableViewDelegate {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { chats.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    let chat = chats[indexPath.row]

    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled"
    content.secondaryText = chat.model ?? chat.effort
    content.image = UIImage(systemName: "message")
    content.imageProperties.tintColor = AppTheme.accent
    cell.contentConfiguration = content
    cell.accessoryType = .disclosureIndicator
    cell.backgroundColor = AppTheme.canvas
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectChat?(chats[indexPath.row])
  }
}
