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
  private let avatar = UILabel()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  deinit { NotificationCenter.default.removeObserver(self) }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = AppTheme.secondarySurface
    setupTopBar()
    setupNavSection()
    setupTable()
    setupNewChatButton()
    NotificationCenter.default.addObserver(self, selector: #selector(approvalCountChanged), name: .approvalCountChanged, object: nil)
    reload()
  }

  // MARK: - Top bar: wordmark + avatar (tap → Settings)

  private func setupTopBar() {
    let wordmark = UILabel()
    wordmark.text = "unnamed"
    wordmark.font = .systemFont(ofSize: 20, weight: .semibold)
    wordmark.textColor = .label

    avatar.backgroundColor = AppTheme.accent
    avatar.textColor = .white
    avatar.font = .systemFont(ofSize: 14, weight: .semibold)
    avatar.textAlignment = .center
    avatar.layer.cornerRadius = 16
    avatar.clipsToBounds = true
    avatar.text = "•"
    avatar.isUserInteractionEnabled = true
    avatar.accessibilityLabel = "Settings"
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.widthAnchor.constraint(equalToConstant: 32).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 32).isActive = true
    avatar.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(settingsTapped)))

    let row = UIStackView(arrangedSubviews: [wordmark, UIView(), avatar])
    row.axis = .horizontal
    row.alignment = .center

    view.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
      row.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      row.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
    ])
    topBarBottom = row.bottomAnchor
  }

  private var topBarBottom: NSLayoutYAxisAnchor!

  // MARK: - Search + flat nav rows (Projects, Inbox)

  private let navStack = UIStackView()

  private func setupNavSection() {
    searchField.placeholder = "Search chats"
    searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

    let projects = flatNavRow(icon: "folder", title: "Projects", action: #selector(projectsTapped))
    let inbox = flatNavRow(icon: "tray", title: "Inbox", action: #selector(inboxTapped))

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
      inboxBadge.trailingAnchor.constraint(equalTo: inbox.trailingAnchor, constant: -14),
      inboxBadge.centerYAnchor.constraint(equalTo: inbox.centerYAnchor),
    ])

    navStack.axis = .vertical
    navStack.spacing = 2
    navStack.addArrangedSubview(searchField)
    navStack.addArrangedSubview(projects)
    navStack.addArrangedSubview(inbox)
    navStack.setCustomSpacing(10, after: searchField)

    view.addSubview(navStack)
    navStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      navStack.topAnchor.constraint(equalTo: topBarBottom, constant: 14),
      navStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
      navStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
    ])
  }

  /// A plain, flat list row — icon + label, no fill or border (matches the
  /// rest of the nav list rather than reading as a separate "button").
  private func flatNavRow(icon: String, title: String, action: Selector) -> UIControl {
    let row = UIControl()
    row.heightAnchor.constraint(equalToConstant: 40).isActive = true
    row.addTarget(self, action: action, for: .touchUpInside)

    let img = UIImageView(image: UIImage(systemName: icon))
    img.tintColor = .secondaryLabel
    img.contentMode = .scaleAspectFit
    img.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      img.widthAnchor.constraint(equalToConstant: 20),
      img.heightAnchor.constraint(equalToConstant: 20),
    ])

    let label = UILabel()
    label.text = title
    label.font = UIFont.preferredFont(forTextStyle: .subheadline)
    label.textColor = .label

    let stack = UIStackView(arrangedSubviews: [img, label])
    stack.axis = .horizontal
    stack.spacing = 12
    stack.alignment = .center
    stack.isUserInteractionEnabled = false
    row.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: row.leadingAnchor, constant: 2),
      stack.centerYAnchor.constraint(equalTo: row.centerYAnchor),
    ])
    return row
  }

  // MARK: - Recents table

  private func setupTable() {
    tableView.backgroundColor = .clear
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "chat")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.rowHeight = 46
    tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 76, right: 0)
    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: navStack.bottomAnchor, constant: 10),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  // MARK: - Floating "New chat" pill

  private func setupNewChatButton() {
    let button = UIButton(type: .system)
    var config = UIButton.Configuration.filled()
    config.title = "New chat"
    config.image = UIImage(systemName: "plus")
    config.imagePadding = 6
    config.cornerStyle = .capsule
    config.baseBackgroundColor = AppTheme.primary
    config.baseForegroundColor = AppTheme.primaryText
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
      label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
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
