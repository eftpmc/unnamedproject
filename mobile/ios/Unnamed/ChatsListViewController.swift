import UIKit

final class ChatsListViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var chats: [ChatSession] = []
  private var activeIds: Set<String> = []
  private var isLoading = true

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
    tableView.register(SkeletonCell.self, forCellReuseIdentifier: SkeletonCell.reuseID)
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
        async let sessions = client.sessions()
        async let active = client.activeSessions()
        chats = try await sessions
        activeIds = Set(try await active)
        isLoading = false
        tableView.reloadData()
      } catch {
        isLoading = false
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }

  private func deleteChat(at indexPath: IndexPath) {
    let chat = chats[indexPath.row]
    Task {
      do {
        try await client.deleteSession(id: chat.id)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        chats.remove(at: indexPath.row)
        tableView.deleteRows(at: [indexPath], with: .automatic)
      } catch {
        showError(error)
      }
    }
  }
}

extension ChatsListViewController: UITableViewDataSource, UITableViewDelegate {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    isLoading ? 6 : chats.count
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    if isLoading {
      return tableView.dequeueReusableCell(withIdentifier: SkeletonCell.reuseID, for: indexPath)
    }
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    let chat = chats[indexPath.row]
    let isActive = activeIds.contains(chat.id)

    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled"
    let timePart = (chat.updatedAt ?? chat.createdAt).map { relativeTime(from: $0) }
    let metaParts = [chat.model ?? chat.effort, timePart].compactMap { $0 }
    content.secondaryText = metaParts.isEmpty ? nil : metaParts.joined(separator: " · ")
    content.image = UIImage(systemName: "message")
    content.imageProperties.tintColor = isActive ? .systemGreen : AppTheme.accent
    cell.contentConfiguration = content
    cell.backgroundColor = AppTheme.canvas

    if isActive {
      cell.accessoryView = makePulseDot()
    } else {
      cell.accessoryView = nil
      cell.accessoryType = .disclosureIndicator
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectChat?(chats[indexPath.row])
  }

  func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    let action = UIContextualAction(style: .destructive, title: "Delete") { [weak self] _, _, done in
      self?.deleteChat(at: indexPath)
      done(true)
    }
    action.image = UIImage(systemName: "trash")
    return UISwipeActionsConfiguration(actions: [action])
  }
}

private func makePulseDot() -> UIView {
  let container = UIView(frame: CGRect(x: 0, y: 0, width: 18, height: 44))
  let dot = UIView(frame: CGRect(x: 5, y: 18, width: 8, height: 8))
  dot.backgroundColor = .systemGreen
  dot.layer.cornerRadius = 4
  container.addSubview(dot)
  let anim = CABasicAnimation(keyPath: "opacity")
  anim.fromValue = 1.0
  anim.toValue = 0.25
  anim.duration = 0.9
  anim.autoreverses = true
  anim.repeatCount = .infinity
  dot.layer.add(anim, forKey: "pulse")
  return container
}
