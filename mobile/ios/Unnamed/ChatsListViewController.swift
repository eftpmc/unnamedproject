import UIKit

final class ChatsListViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var chats: [ChatSession] = []
  private var activeIds: Set<String> = []
  private var isLoading = true
  private var wsSubscriptionId: UUID?

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

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain, target: self, action: #selector(composeTapped)
    )
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

    wsSubscriptionId = WebSocketService.shared.subscribe { [weak self] event in
      self?.handleWSEvent(event)
    }

    load()
  }

  deinit {
    if let id = wsSubscriptionId { WebSocketService.shared.unsubscribe(id) }
  }

  @objc private func composeTapped() {
    let sheet = UIAlertController(title: "New Chat", message: "Choose a model", preferredStyle: .actionSheet)

    let options: [(display: String, model: String, effort: String)] = [
      ("Haiku · Low",     "claude-haiku-4-5-20251001", "low"),
      ("Sonnet · Medium", "claude-sonnet-4-6",         "medium"),
      ("Sonnet · High",   "claude-sonnet-4-6",         "high"),
      ("Opus · High",     "claude-opus-4-8",           "high"),
    ]
    for opt in options {
      sheet.addAction(UIAlertAction(title: opt.display, style: .default) { [weak self] _ in
        self?.startChat(model: opt.model, effort: opt.effort)
      })
    }
    sheet.addAction(UIAlertAction(title: "Default", style: .default) { [weak self] _ in
      self?.startChat(model: nil, effort: nil)
    })
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    present(sheet, animated: true)
  }

  private func startChat(model: String?, effort: String?) {
    Task {
      do {
        let created = try await client.createSession(model: model, effort: effort)
        let chat = ChatSession(id: created.id, title: nil, effort: effort, model: model,
                               pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        onSelectChat?(chat)
      } catch {
        showError(error)
      }
    }
  }

  private func handleWSEvent(_ event: WSEvent) {
    switch event {
    case .messageCreated(let sid, _):
      guard let idx = chats.firstIndex(where: { $0.id == sid }) else { return }
      activeIds.insert(sid)
      tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)

    case .turnComplete(let sid, _):
      guard let idx = chats.firstIndex(where: { $0.id == sid }) else { return }
      activeIds.remove(sid)
      tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)

    case .sessionTitleUpdated(let sid, let newTitle):
      guard let idx = chats.firstIndex(where: { $0.id == sid }) else { return }
      let old = chats[idx]
      chats[idx] = ChatSession(id: old.id, title: newTitle, effort: old.effort, model: old.model,
                               pinnedProjectId: old.pinnedProjectId, createdAt: old.createdAt, updatedAt: old.updatedAt)
      tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)

    default:
      break
    }
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
