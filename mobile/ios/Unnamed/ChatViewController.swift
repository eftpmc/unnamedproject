import UIKit

final class ChatViewController: UIViewController {
  private let appSession: AppSession
  private let chatSession: ChatSession
  private lazy var client = APIClient(session: appSession)

  private var messages: [ChatMessage] = []
  private var wsSubscriptionId: UUID?

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()
  private let composeBar = UIView()
  private let textView = ComposerTextView()
  private let sendButton = UIButton(type: .system)
  private let sendActivity = UIActivityIndicatorView(style: .medium)
  private var composeBarBottom: NSLayoutConstraint!
  private var pollTimer: Timer?

  // Agent status bar (between table and compose bar)
  private let agentStatusBar = UIView()
  private let agentStatusLabel = UILabel()
  private let agentStatusSpinner = UIActivityIndicatorView(style: .medium)
  private var agentStatusHeight: NSLayoutConstraint!

  // Reconnect banner
  private let reconnectBanner = UIView()
  private var reconnectBannerHeight: NSLayoutConstraint!
  private var pendingBannerItem: DispatchWorkItem?

  init(appSession: AppSession, chatSession: ChatSession) {
    self.appSession = appSession
    self.chatSession = chatSession
    super.init(nibName: nil, bundle: nil)
    hidesBottomBarWhenPushed = true
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    startPolling()
    subscribeWebSocket()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    stopPolling()
    unsubscribeWebSocket()
  }

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
    setupAgentStatusBar()
    setupComposeBar()
    setupReconnectBanner()
    observeKeyboard()
    loadMessages()
  }

  deinit {
    pollTimer?.invalidate()
    if let id = wsSubscriptionId { WebSocketService.shared.unsubscribe(id) }
    NotificationCenter.default.removeObserver(self)
  }

  private func startPolling() {
    pollTimer?.invalidate()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
      guard let self else { return }
      Task { await self.pollMessages() }
    }
  }

  private func stopPolling() {
    pollTimer?.invalidate()
    pollTimer = nil
  }

  // MARK: - WebSocket

  private func subscribeWebSocket() {
    guard wsSubscriptionId == nil else { return }
    wsSubscriptionId = WebSocketService.shared.subscribe { [weak self] event in
      self?.handleWSEvent(event)
    }
  }

  private func unsubscribeWebSocket() {
    if let id = wsSubscriptionId {
      WebSocketService.shared.unsubscribe(id)
      wsSubscriptionId = nil
    }
  }

  private func handleWSEvent(_ event: WSEvent) {
    switch event {
    case .messageStarted(let sid, let message) where sid == chatSession.id:
      setAgentStatus(nil)
      guard !messages.contains(where: { $0.id == message.id }) else { return }
      messages.append(message)
      let ip = IndexPath(row: messages.count - 1, section: 0)
      tableView.insertRows(at: [ip], with: .none)
      if isNearBottom() { scrollToBottom(animated: true) }

    case .messageDelta(let sid, let messageId, let delta) where sid == chatSession.id:
      guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
      let old = messages[idx]
      messages[idx] = ChatMessage(id: old.id, role: old.role, content: old.content + delta, createdAt: old.createdAt)
      tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)
      if isNearBottom() { scrollToBottom(animated: false) }

    case .messageCreated(let sid, let message) where sid == chatSession.id:
      if let idx = messages.firstIndex(where: { $0.id == message.id }) {
        messages[idx] = message
        tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)
      } else {
        messages.append(message)
        let ip = IndexPath(row: messages.count - 1, section: 0)
        tableView.insertRows(at: [ip], with: .none)
        if isNearBottom() { scrollToBottom(animated: true) }
      }

    case .turnComplete(let sid, _) where sid == chatSession.id:
      setAgentStatus(nil)
      setSending(false)
      Task { await reloadMessages() }

    case .executionUpdate(let sid, let tool, let status) where sid == chatSession.id || sid == nil:
      guard sid == chatSession.id else { break }
      switch status {
      case "running":
        let name = tool.map { formatToolName($0) } ?? "Working"
        setAgentStatus("\(name)…")
      case "awaiting_approval":
        setAgentStatus("Waiting for approval…")
      default:
        setAgentStatus(nil)
      }

    case .sessionTitleUpdated(let sid, let t) where sid == chatSession.id:
      title = t

    case .connected:
      pendingBannerItem?.cancel()
      pendingBannerItem = nil
      hideReconnectBanner()

    case .disconnected:
      pendingBannerItem?.cancel()
      let item = DispatchWorkItem { [weak self] in self?.showReconnectBanner() }
      pendingBannerItem = item
      DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: item)

    default:
      break
    }
  }

  private func formatToolName(_ raw: String) -> String {
    raw.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
  }

  // MARK: - Layout

  private func setupAgentStatusBar() {
    agentStatusBar.backgroundColor = AppTheme.surface
    agentStatusBar.clipsToBounds = true

    let border = UIView()
    border.backgroundColor = AppTheme.border
    agentStatusBar.addSubview(border)
    border.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      border.topAnchor.constraint(equalTo: agentStatusBar.topAnchor),
      border.leadingAnchor.constraint(equalTo: agentStatusBar.leadingAnchor),
      border.trailingAnchor.constraint(equalTo: agentStatusBar.trailingAnchor),
      border.heightAnchor.constraint(equalToConstant: 0.5),
    ])

    agentStatusSpinner.color = .tertiaryLabel
    agentStatusSpinner.startAnimating()

    agentStatusLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
    agentStatusLabel.textColor = .secondaryLabel

    let row = UIStackView(arrangedSubviews: [agentStatusSpinner, agentStatusLabel])
    row.axis = .horizontal
    row.spacing = 7
    row.alignment = .center
    agentStatusBar.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.centerXAnchor.constraint(equalTo: agentStatusBar.centerXAnchor),
      row.centerYAnchor.constraint(equalTo: agentStatusBar.centerYAnchor),
    ])

    agentStatusHeight = agentStatusBar.heightAnchor.constraint(equalToConstant: 0)
    agentStatusHeight.isActive = true
    view.addSubview(agentStatusBar)
    agentStatusBar.translatesAutoresizingMaskIntoConstraints = false
  }

  private func setupReconnectBanner() {
    reconnectBanner.backgroundColor = AppTheme.warning.withAlphaComponent(0.9)
    reconnectBanner.clipsToBounds = true

    let label = UILabel()
    label.text = "Reconnecting…"
    label.font = UIFont.preferredFont(forTextStyle: .caption1)
    label.textColor = .white
    label.textAlignment = .center
    reconnectBanner.addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: reconnectBanner.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: reconnectBanner.centerYAnchor),
    ])

    view.addSubview(reconnectBanner)
    reconnectBanner.translatesAutoresizingMaskIntoConstraints = false
    reconnectBannerHeight = reconnectBanner.heightAnchor.constraint(equalToConstant: 0)
    NSLayoutConstraint.activate([
      reconnectBanner.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      reconnectBanner.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      reconnectBanner.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      reconnectBannerHeight,
    ])
    view.bringSubviewToFront(reconnectBanner)
  }

  private func setAgentStatus(_ text: String?) {
    agentStatusLabel.text = text
    agentStatusHeight.constant = text == nil ? 0 : 36
    UIView.animate(withDuration: 0.2) { self.view.layoutIfNeeded() }
  }

  private func showReconnectBanner() {
    reconnectBannerHeight.constant = 28
    UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
  }

  private func hideReconnectBanner() {
    reconnectBannerHeight.constant = 0
    UIView.animate(withDuration: 0.25) { self.view.layoutIfNeeded() }
  }

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
    tableView.refreshControl = refreshControl
    refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)

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
      tableView.bottomAnchor.constraint(equalTo: agentStatusBar.topAnchor),
      agentStatusBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      agentStatusBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      agentStatusBar.bottomAnchor.constraint(equalTo: composeBar.topAnchor),
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
      applyMessages(updated, scrollAnimated: true)
    } catch {}
  }

  @MainActor
  private func pollMessages() async {
    do {
      let updated = try await client.messages(sessionId: chatSession.id)
      guard updated.count != messages.count || updated.last?.id != messages.last?.id else { return }
      let nearBottom = isNearBottom()
      applyMessages(updated, scrollAnimated: nearBottom)
    } catch {}
  }

  private func applyMessages(_ updated: [ChatMessage], scrollAnimated: Bool) {
    messages = updated
    tableView.reloadData()
    if scrollAnimated { scrollToBottom(animated: true) }
  }

  private func isNearBottom() -> Bool {
    let bottom = tableView.contentSize.height - tableView.frame.height
    return tableView.contentOffset.y >= bottom - 80
  }

  private func scrollToBottom(animated: Bool) {
    guard !messages.isEmpty else { return }
    tableView.scrollToRow(at: IndexPath(row: messages.count - 1, section: 0), at: .bottom, animated: animated)
  }

  // MARK: - Actions

  @objc private func refreshTapped() {
    Task { await reloadMessages() }
  }

  @objc private func refreshPulled() {
    Task {
      await reloadMessages()
      refreshControl.endRefreshing()
    }
  }

  @objc private func sendTapped() {
    let text = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }

    textView.text = ""
    setSending(true)
    setAgentStatus("Working…")

    let optimistic = ChatMessage(id: UUID().uuidString, role: "user", content: text, createdAt: nil)
    messages.append(optimistic)
    let ip = IndexPath(row: messages.count - 1, section: 0)
    tableView.insertRows(at: [ip], with: .automatic)
    scrollToBottom(animated: true)

    Task {
      do {
        _ = try await client.sendMessage(sessionId: chatSession.id, content: text)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        // Brief pause to catch fast agent responses before first reload
        try? await Task.sleep(nanoseconds: 800_000_000)
        await reloadMessages()
      } catch {
        // Roll back optimistic message
        if let idx = messages.firstIndex(where: { $0.id == optimistic.id }) {
          messages.remove(at: idx)
          tableView.deleteRows(at: [IndexPath(row: idx, section: 0)], with: .automatic)
        }
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        setAgentStatus(nil)
        textView.text = text
        showError(error)
      }
      setSending(false)
    }
  }

  private func showMessageActions(_ text: String) {
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
    sheet.addAction(UIAlertAction(title: "Copy", style: .default) { _ in
      UIPasteboard.general.string = text
    })
    sheet.addAction(UIAlertAction(title: "Share", style: .default) { [weak self] _ in
      let vc = UIActivityViewController(activityItems: [text], applicationActivities: nil)
      self?.present(vc, animated: true)
    })
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    present(sheet, animated: true)
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
    cell.onLongPress = { [weak self] text in self?.showMessageActions(text) }
    return cell
  }
}

// MARK: - MessageCell

private final class MessageCell: UITableViewCell {
  static let reuseID = "MessageCell"
  var onLongPress: ((String) -> Void)?
  private var rawContent = ""

  private let bubbleStack = UIStackView()
  private let bubble = UIView()
  private let label = UILabel()
  private let timeLabel = UILabel()
  private var stackLeading: NSLayoutConstraint!
  private var stackTrailing: NSLayoutConstraint!

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none

    let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress))
    contentView.addGestureRecognizer(longPress)

    bubble.layer.cornerRadius = 18
    bubble.layer.cornerCurve = .continuous

    label.numberOfLines = 0
    label.font = UIFont.preferredFont(forTextStyle: .callout)
    label.adjustsFontForContentSizeCategory = true

    timeLabel.font = UIFont.preferredFont(forTextStyle: .caption2)
    timeLabel.textColor = .tertiaryLabel
    timeLabel.adjustsFontForContentSizeCategory = true

    bubble.addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 10),
      label.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 14),
      label.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -14),
      label.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -10),
    ])

    bubbleStack.axis = .vertical
    bubbleStack.spacing = 3
    bubbleStack.addArrangedSubview(bubble)
    bubbleStack.addArrangedSubview(timeLabel)

    contentView.addSubview(bubbleStack)
    bubbleStack.translatesAutoresizingMaskIntoConstraints = false

    stackLeading = bubbleStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16)
    stackTrailing = bubbleStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16)

    NSLayoutConstraint.activate([
      bubbleStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 3),
      bubbleStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -3),
      bubbleStack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.78),
    ])
  }

  required init?(coder: NSCoder) { fatalError() }

  @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
    guard gesture.state == .began else { return }
    onLongPress?(rawContent)
  }

  func configure(with message: ChatMessage) {
    rawContent = message.content
    let isUser = message.role == "user"
    let textColor: UIColor = isUser ? AppTheme.primaryText : .label
    label.attributedText = markdownAttributedString(message.content, baseFont: label.font, textColor: textColor)
    bubble.backgroundColor = isUser ? AppTheme.primary : AppTheme.secondarySurface

    if let epoch = message.createdAt {
      timeLabel.text = messageTime(epoch)
      timeLabel.textAlignment = isUser ? .right : .left
      timeLabel.isHidden = false
    } else {
      timeLabel.isHidden = true
    }

    if isUser {
      stackLeading.isActive = false
      stackTrailing.isActive = true
    } else {
      stackTrailing.isActive = false
      stackLeading.isActive = true
    }
  }
}

private func messageTime(_ epoch: Int) -> String {
  let date = Date(timeIntervalSince1970: TimeInterval(epoch))
  let cal = Calendar.current
  let timeFmt = DateFormatter()
  timeFmt.dateFormat = "h:mm a"
  if cal.isDateInToday(date) { return timeFmt.string(from: date) }
  if cal.isDateInYesterday(date) { return "Yesterday " + timeFmt.string(from: date) }
  let fullFmt = DateFormatter()
  fullFmt.dateStyle = .short
  fullFmt.timeStyle = .short
  return fullFmt.string(from: date)
}
