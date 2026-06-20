// mobile/ios/Unnamed/SidebarViewController.swift
import UIKit

final class SidebarViewController: UIViewController {
  var onSelectChat: ((ChatSession) -> Void)?
  var onNewChat: (() -> Void)?
  var onShowProjects: (() -> Void)?
  var onShowInbox: (() -> Void)?
  var onShowSettings: (() -> Void)?

  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)

  private var allChats: [ChatSession] = []
  private var grouped: [(group: ChatTimeGroup, chats: [ChatSession])] = []
  private var activeIds: Set<String> = []
  private var filter = ""
  private var email = "—"

  private let searchField = UISearchTextField()
  private let tableView = UITableView(frame: .zero, style: .plain)
  private let inboxBadge = UILabel()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = AppTheme.secondarySurface
    setupHeader()
    setupTable()
    setupAccountFooter()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  // Pinned header: search + New chat + Projects + Inbox(badge)
  private let headerStack = UIStackView()

  private func setupHeader() {
    headerStack.axis = .vertical
    headerStack.spacing = 8
    headerStack.isLayoutMarginsRelativeArrangement = true
    headerStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 8, leading: 14, bottom: 6, trailing: 14)

    searchField.placeholder = "Search chats"
    searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

    let newChat = navButton(icon: "square.and.pencil", title: "New chat", primary: true, action: #selector(newChatTapped))
    let projects = navButton(icon: "folder", title: "Projects", primary: false, action: #selector(projectsTapped))
    let inbox = navButton(icon: "tray", title: "Inbox", primary: false, action: #selector(inboxTapped))

    inboxBadge.font = .systemFont(ofSize: 11, weight: .bold)
    inboxBadge.textColor = .white
    inboxBadge.textAlignment = .center
    inboxBadge.backgroundColor = AppTheme.warning
    inboxBadge.layer.cornerRadius = 9
    inboxBadge.clipsToBounds = true
    inboxBadge.isHidden = true
    inboxBadge.translatesAutoresizingMaskIntoConstraints = false
    inbox.addSubview(inboxBadge)
    NSLayoutConstraint.activate([
      inboxBadge.heightAnchor.constraint(equalToConstant: 18),
      inboxBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 22),
      inboxBadge.trailingAnchor.constraint(equalTo: inbox.trailingAnchor, constant: -12),
      inboxBadge.centerYAnchor.constraint(equalTo: inbox.centerYAnchor),
    ])

    headerStack.addArrangedSubview(searchField)
    headerStack.addArrangedSubview(newChat)
    headerStack.addArrangedSubview(projects)
    headerStack.addArrangedSubview(inbox)

    view.addSubview(headerStack)
    headerStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      headerStack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
      headerStack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      headerStack.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  private func navButton(icon: String, title: String, primary: Bool, action: Selector) -> UIControl {
    let row = UIControl()
    row.backgroundColor = primary ? AppTheme.primary : AppTheme.surface
    row.layer.cornerRadius = 12
    row.layer.cornerCurve = .continuous
    row.heightAnchor.constraint(equalToConstant: 44).isActive = true
    row.addTarget(self, action: action, for: .touchUpInside)

    let img = UIImageView(image: UIImage(systemName: icon))
    img.tintColor = primary ? AppTheme.primaryText : .label
    let label = UILabel()
    label.text = title
    label.font = UIFont.preferredFont(forTextStyle: .subheadline)
    label.textColor = primary ? AppTheme.primaryText : .label

    let stack = UIStackView(arrangedSubviews: [img, label])
    stack.axis = .horizontal
    stack.spacing = 10
    stack.alignment = .center
    stack.isUserInteractionEnabled = false
    row.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 14),
      stack.centerYAnchor.constraint(equalTo: row.centerYAnchor),
    ])
    return row
  }

  private func setupTable() {
    tableView.backgroundColor = .clear
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "chat")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.rowHeight = 46
    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 4),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
  }

  private let accountRow = UIControl()
  private let emailLabel = UILabel()
  private let avatar = UILabel()

  private func setupAccountFooter() {
    accountRow.backgroundColor = AppTheme.surface
    accountRow.addTarget(self, action: #selector(settingsTapped), for: .touchUpInside)

    avatar.backgroundColor = AppTheme.accent
    avatar.textColor = .white
    avatar.font = .systemFont(ofSize: 14, weight: .semibold)
    avatar.textAlignment = .center
    avatar.layer.cornerRadius = 16
    avatar.clipsToBounds = true
    avatar.text = "•"
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.widthAnchor.constraint(equalToConstant: 32).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 32).isActive = true

    emailLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    emailLabel.textColor = .label

    let gear = UIImageView(image: UIImage(systemName: "gearshape"))
    gear.tintColor = .secondaryLabel

    let stack = UIStackView(arrangedSubviews: [avatar, emailLabel, UIView(), gear])
    stack.axis = .horizontal
    stack.spacing = 10
    stack.alignment = .center
    stack.isUserInteractionEnabled = false
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
    accountRow.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    stack.pinToSuperviewEdges()

    let topBorder = UIView()
    topBorder.backgroundColor = AppTheme.border
    accountRow.addSubview(topBorder)
    topBorder.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      topBorder.topAnchor.constraint(equalTo: accountRow.topAnchor),
      topBorder.leadingAnchor.constraint(equalTo: accountRow.leadingAnchor),
      topBorder.trailingAnchor.constraint(equalTo: accountRow.trailingAnchor),
      topBorder.heightAnchor.constraint(equalToConstant: 0.5),
    ])

    view.addSubview(accountRow)
    accountRow.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      accountRow.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      accountRow.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      accountRow.topAnchor.constraint(equalTo: tableView.bottomAnchor),
      accountRow.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

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

  private func applyFilterAndRender() {
    let filtered = filter.isEmpty
      ? allChats
      : allChats.filter { ($0.title ?? "").localizedCaseInsensitiveContains(filter) }
    grouped = groupChatsByTime(filtered)
    emailLabel.text = email
    avatar.text = email.first.map { String($0).uppercased() } ?? "•"
    let n = ApprovalCenter.shared.count
    inboxBadge.text = "\(min(n, 99))"
    inboxBadge.isHidden = n == 0
    tableView.reloadData()
  }

  @objc private func searchChanged() { filter = searchField.text ?? ""; applyFilterAndRender() }
  @objc private func newChatTapped() { onNewChat?() }
  @objc private func projectsTapped() { onShowProjects?() }
  @objc private func inboxTapped() { onShowInbox?() }
  @objc private func settingsTapped() { onShowSettings?() }
  @objc private func approvalCountChanged() { applyFilterAndRender() }
}

extension SidebarViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { grouped.count }
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { grouped[section].chats.count }

  func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
    let container = UIView()
    container.backgroundColor = .clear

    let label = UILabel()
    label.text = grouped[section].group.label
    label.font = UIFont.preferredFont(forTextStyle: .footnote)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .secondaryLabel
    container.addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 12),
      label.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -12),
      label.topAnchor.constraint(equalTo: container.topAnchor, constant: 6),
      label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -6),
    ])
    return container
  }

  func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat { 28 }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "chat", for: indexPath)
    let chat = grouped[indexPath.section].chats[indexPath.row]
    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled chat"
    content.textProperties.font = UIFont.preferredFont(forTextStyle: .subheadline)
    content.textProperties.numberOfLines = 1
    cell.contentConfiguration = content
    cell.backgroundColor = .clear
    if activeIds.contains(chat.id) {
      let dot = UIView(frame: CGRect(x: 0, y: 0, width: 8, height: 8))
      dot.backgroundColor = .systemGreen
      dot.layer.cornerRadius = 4
      cell.accessoryView = dot
    } else {
      cell.accessoryView = nil
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    onSelectChat?(grouped[indexPath.section].chats[indexPath.row])
  }
}
