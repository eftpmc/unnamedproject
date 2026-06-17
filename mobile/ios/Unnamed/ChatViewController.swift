import UIKit

final class ChatViewController: UIViewController {
  private let appSession: AppSession
  private let chatSession: ChatSession
  private lazy var client = APIClient(session: appSession)

  private var messages: [ChatMessage] = []

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let composeBar = UIView()
  private let textView = ComposerTextView()
  private let sendButton = UIButton(type: .system)
  private let sendActivity = UIActivityIndicatorView(style: .medium)
  private var composeBarBottom: NSLayoutConstraint!

  init(appSession: AppSession, chatSession: ChatSession) {
    self.appSession = appSession
    self.chatSession = chatSession
    super.init(nibName: nil, bundle: nil)
    hidesBottomBarWhenPushed = true
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = chatSession.title ?? "Chat"
    view.backgroundColor = AppTheme.canvas

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "arrow.clockwise"),
      style: .plain,
      target: self,
      action: #selector(refreshTapped)
    )

    setupTable()
    setupComposeBar()
    observeKeyboard()
    loadMessages()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: - Layout

  private func setupTable() {
    tableView.backgroundColor = .clear
    tableView.separatorStyle = .none
    tableView.register(MessageCell.self, forCellReuseIdentifier: MessageCell.reuseID)
    tableView.dataSource = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 80
    tableView.keyboardDismissMode = .interactive
    tableView.allowsSelection = false
    tableView.contentInset = UIEdgeInsets(top: 12, left: 0, bottom: 12, right: 0)

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
  }

  private func setupComposeBar() {
    composeBar.backgroundColor = AppTheme.surface
    let topBorder = UIView()
    topBorder.backgroundColor = AppTheme.border
    topBorder.translatesAutoresizingMaskIntoConstraints = false
    composeBar.addSubview(topBorder)
    NSLayoutConstraint.activate([
      topBorder.leadingAnchor.constraint(equalTo: composeBar.leadingAnchor),
      topBorder.trailingAnchor.constraint(equalTo: composeBar.trailingAnchor),
      topBorder.topAnchor.constraint(equalTo: composeBar.topAnchor),
      topBorder.heightAnchor.constraint(equalToConstant: 0.5),
    ])

    textView.placeholder = "Message..."

    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .capsule
    sendButton.configuration?.baseBackgroundColor = AppTheme.primary
    sendButton.configuration?.baseForegroundColor = AppTheme.primaryText
    sendButton.configuration?.image = UIImage(systemName: "arrow.up")
    sendButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 7, bottom: 7, trailing: 7)
    sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
    NSLayoutConstraint.activate([
      sendButton.widthAnchor.constraint(equalToConstant: 34),
      sendButton.heightAnchor.constraint(equalToConstant: 34),
    ])

    sendActivity.hidesWhenStopped = true

    let row = UIStackView(arrangedSubviews: [textView, sendActivity, sendButton])
    row.axis = .horizontal
    row.alignment = .bottom
    row.spacing = 8
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 0, trailing: 14)

    composeBar.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: composeBar.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: composeBar.trailingAnchor),
      row.topAnchor.constraint(equalTo: composeBar.topAnchor),
      row.bottomAnchor.constraint(equalTo: composeBar.safeAreaLayoutGuide.bottomAnchor, constant: -10),
    ])

    view.addSubview(composeBar)
    composeBar.translatesAutoresizingMaskIntoConstraints = false
    composeBarBottom = composeBar.bottomAnchor.constraint(equalTo: view.bottomAnchor)

    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: composeBar.topAnchor),
      composeBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      composeBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      composeBarBottom,
    ])
  }

  private func observeKeyboard() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(keyboardChanged(_:)),
      name: UIResponder.keyboardWillChangeFrameNotification, object: nil
    )
  }

  // MARK: - Keyboard

  @objc private func keyboardChanged(_ note: Notification) {
    guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
          let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
    let overlap = max(0, UIScreen.main.bounds.height - frame.minY)
    UIView.animate(withDuration: duration) {
      self.composeBarBottom.constant = -overlap
      self.view.layoutIfNeeded()
    }
  }

  // MARK: - Data

  private func loadMessages() {
    Task {
      do {
        let loaded = try await client.messages(sessionId: chatSession.id)
        messages = loaded
        tableView.reloadData()
        scrollToBottom(animated: false)
      } catch {
        // Non-fatal: show empty state silently
      }
    }
  }

  @MainActor
  private func reloadMessages() async {
    do {
      let updated = try await client.messages(sessionId: chatSession.id)
      messages = updated
      tableView.reloadData()
      scrollToBottom(animated: true)
    } catch {}
  }

  private func scrollToBottom(animated: Bool) {
    guard !messages.isEmpty else { return }
    tableView.scrollToRow(at: IndexPath(row: messages.count - 1, section: 0), at: .bottom, animated: animated)
  }

  // MARK: - Actions

  @objc private func refreshTapped() {
    Task { await reloadMessages() }
  }

  @objc private func sendTapped() {
    let text = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }

    textView.text = ""
    setSending(true)

    let optimistic = ChatMessage(id: UUID().uuidString, role: "user", content: text, createdAt: nil)
    messages.append(optimistic)
    let ip = IndexPath(row: messages.count - 1, section: 0)
    tableView.insertRows(at: [ip], with: .automatic)
    scrollToBottom(animated: true)

    Task {
      do {
        _ = try await client.sendMessage(sessionId: chatSession.id, content: text)
        // Brief pause to catch fast agent responses before first reload
        try? await Task.sleep(nanoseconds: 800_000_000)
        await reloadMessages()
      } catch {
        // Roll back optimistic message
        if let idx = messages.firstIndex(where: { $0.id == optimistic.id }) {
          messages.remove(at: idx)
          tableView.deleteRows(at: [IndexPath(row: idx, section: 0)], with: .automatic)
        }
        textView.text = text
        showError(error)
      }
      setSending(false)
    }
  }

  private func setSending(_ active: Bool) {
    sendButton.isEnabled = !active
    textView.isEditable = !active
    active ? sendActivity.startAnimating() : sendActivity.stopAnimating()
  }
}

// MARK: - UITableViewDataSource

extension ChatViewController: UITableViewDataSource {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { messages.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: MessageCell.reuseID, for: indexPath) as! MessageCell
    cell.configure(with: messages[indexPath.row])
    return cell
  }
}

// MARK: - MessageCell

private final class MessageCell: UITableViewCell {
  static let reuseID = "MessageCell"

  private let bubble = UIView()
  private let label = UILabel()
  private var leadingConstraint: NSLayoutConstraint!
  private var trailingConstraint: NSLayoutConstraint!

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none

    bubble.layer.cornerRadius = 18
    bubble.layer.cornerCurve = .continuous

    label.numberOfLines = 0
    label.font = UIFont.preferredFont(forTextStyle: .callout)
    label.adjustsFontForContentSizeCategory = true

    contentView.addSubview(bubble)
    bubble.addSubview(label)
    bubble.translatesAutoresizingMaskIntoConstraints = false
    label.translatesAutoresizingMaskIntoConstraints = false

    leadingConstraint = bubble.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16)
    trailingConstraint = bubble.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16)

    NSLayoutConstraint.activate([
      bubble.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 3),
      bubble.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -3),
      bubble.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.78),
      label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 10),
      label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 14),
      label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -14),
      label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -10),
    ])
  }

  required init?(coder: NSCoder) { fatalError() }

  func configure(with message: ChatMessage) {
    label.text = message.content
    let isUser = message.role == "user"
    bubble.backgroundColor = isUser ? AppTheme.primary : AppTheme.secondarySurface
    label.textColor = isUser ? AppTheme.primaryText : .label
    if isUser {
      leadingConstraint.isActive = false
      trailingConstraint.isActive = true
    } else {
      trailingConstraint.isActive = false
      leadingConstraint.isActive = true
    }
  }
}
