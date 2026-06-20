import UIKit

final class ChatViewController: UIViewController {
  var onOpenSidebar: (() -> Void)?
  private let isNew: Bool
  private let appSession: AppSession
  private let chatSession: ChatSession
  /// The session id messages/polling/websocket actually operate against.
  /// Starts equal to `chatSession.id`, but gets populated once a brand-new
  /// chat (empty id) is lazily created on first send.
  private var activeSessionId: String
  private lazy var client = APIClient(session: appSession)

  private var messages: [ChatMessage] = []
  private var toolEvents: [ToolEvent] = []
  private var wsSubscriptionId: UUID?
  private var isLoaded = false

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

  init(appSession: AppSession, chatSession: ChatSession, isNew: Bool = false) {
    self.appSession = appSession
    self.chatSession = chatSession
    self.activeSessionId = chatSession.id
    self.isNew = isNew
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
    view.backgroundColor = AppTheme.canvas

    title = isNew ? "New chat" : (chatSession.title ?? "Chat")
    // Always compact: guards against Projects/Settings leaving the shared
    // nav bar in large-title mode when chat becomes the root again.
    navigationItem.largeTitleDisplayMode = .never
    navigationController?.navigationBar.prefersLargeTitles = false
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "sidebar.left"),
      style: .plain, target: self, action: #selector(openSidebarTapped))
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain, target: self, action: #selector(composeNewTapped))

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
    case .messageStarted(let sid, let message) where sid == activeSessionId:
      setAgentStatus(nil)
      guard !messages.contains(where: { $0.id == message.id }) else { return }
      messages.append(message)
      updateEmptyState()
      let ip = IndexPath(row: messages.count - 1, section: 0)
      tableView.insertRows(at: [ip], with: .none)
      if isNearBottom() { scrollToBottom(animated: true) }

    case .messageDelta(let sid, let messageId, let delta) where sid == activeSessionId:
      guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
      let old = messages[idx]
      messages[idx] = ChatMessage(id: old.id, role: old.role, content: old.content + delta, createdAt: old.createdAt)
      tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)
      if isNearBottom() { scrollToBottom(animated: false) }

    case .messageCreated(let sid, let message) where sid == activeSessionId:
      if let idx = messages.firstIndex(where: { $0.id == message.id }) {
        messages[idx] = message
        tableView.reloadRows(at: [IndexPath(row: idx, section: 0)], with: .none)
      } else {
        messages.append(message)
        let ip = IndexPath(row: messages.count - 1, section: 0)
        tableView.insertRows(at: [ip], with: .none)
        if isNearBottom() { scrollToBottom(animated: true) }
      }

    case .turnComplete(let sid, _) where sid == activeSessionId:
      setAgentStatus(nil)
      setSending(false)
      // Finalize any still-running tool events
      for i in toolEvents.indices where toolEvents[i].status == "running" {
        toolEvents[i].status = "done"
      }
      tableView.reloadData()
      Task { await reloadMessages() }

    case .executionUpdate(let sid, let executionId, let tool, let status, let chunk, let result)
        where sid == activeSessionId:
      handleExecutionUpdate(executionId: executionId, tool: tool, status: status, chunk: chunk, result: result)

    case .sessionTitleUpdated(let sid, let t) where sid == activeSessionId:
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

  private func handleExecutionUpdate(executionId: String, tool: String?, status: String?, chunk: String?, result: String?) {
    if let status {
      switch status {
      case "running":
        let name = tool.map { formatToolName($0) } ?? "Working"
        setAgentStatus("\(name)…")
        if !toolEvents.contains(where: { $0.executionId == executionId }) {
          toolEvents.append(ToolEvent(executionId: executionId, tool: tool ?? "tool", status: "running"))
          let ip = IndexPath(row: messages.count + toolEvents.count - 1, section: 0)
          tableView.insertRows(at: [ip], with: .fade)
          if isNearBottom() { scrollToBottom(animated: true) }
        }
      case "awaiting_approval":
        setAgentStatus("Waiting for approval…")
        updateToolEvent(executionId: executionId) { $0.status = "running" }
      case "done", "error":
        if status == "done" { setAgentStatus(nil) }
        updateToolEvent(executionId: executionId) {
          $0.status = status
          $0.result = result
        }
      default: break
      }
    } else if let chunk {
      updateToolEvent(executionId: executionId) { $0.output += chunk }
    }
  }

  private func updateToolEvent(executionId: String, update: (inout ToolEvent) -> Void) {
    guard let idx = toolEvents.firstIndex(where: { $0.executionId == executionId }) else { return }
    update(&toolEvents[idx])
    tableView.reloadRows(at: [IndexPath(row: messages.count + idx, section: 0)], with: .none)
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
    tableView.register(ToolEventCell.self, forCellReuseIdentifier: ToolEventCell.reuseID)
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
    guard !activeSessionId.isEmpty else { isLoaded = true; updateEmptyState(); return }
    Task {
      do {
        let loaded = try await client.messages(sessionId: activeSessionId)
        messages = loaded
        isLoaded = true
        tableView.reloadData()
        updateEmptyState()
        scrollToBottom(animated: false)
      } catch {
        isLoaded = true
        updateEmptyState()
      }
    }
  }

  private func updateEmptyState() {
    guard isLoaded else { return }
    if messages.isEmpty {
      let container = UIView()
      let icon = UIImageView(image: UIImage(systemName: "bubble.left.and.bubble.right"))
      icon.tintColor = .tertiaryLabel
      icon.contentMode = .scaleAspectFit
      icon.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        icon.widthAnchor.constraint(equalToConstant: 44),
        icon.heightAnchor.constraint(equalToConstant: 44),
      ])
      let title = UILabel()
      title.text = "Start the conversation"
      title.font = UIFont.preferredFont(forTextStyle: .headline)
      title.textAlignment = .center
      let sub = UILabel()
      sub.text = "Send a message below."
      sub.font = UIFont.preferredFont(forTextStyle: .subheadline)
      sub.textColor = .secondaryLabel
      sub.textAlignment = .center
      let stack = UIStackView(arrangedSubviews: [icon, title, sub])
      stack.axis = .vertical
      stack.alignment = .center
      stack.spacing = 8
      stack.setCustomSpacing(14, after: icon)
      container.addSubview(stack)
      stack.translatesAutoresizingMaskIntoConstraints = false
      NSLayoutConstraint.activate([
        stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
        stack.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -40),
        stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
        stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
      ])
      tableView.backgroundView = container
    } else {
      tableView.backgroundView = nil
    }
  }

  @MainActor
  private func reloadMessages() async {
    do {
      let updated = try await client.messages(sessionId: activeSessionId)
      applyMessages(updated, scrollAnimated: true)
    } catch {}
  }

  @MainActor
  private func pollMessages() async {
    do {
      let updated = try await client.messages(sessionId: activeSessionId)
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
    let count = messages.count + toolEvents.count
    guard count > 0 else { return }
    tableView.scrollToRow(at: IndexPath(row: count - 1, section: 0), at: .bottom, animated: animated)
  }

  // MARK: - Actions

  @objc private func refreshTapped() {
    Task { await reloadMessages() }
  }

  @objc private func openSidebarTapped() { onOpenSidebar?() }
  @objc private func composeNewTapped() { onOpenSidebar?() }

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
        if activeSessionId.isEmpty {
          let created = try await client.createSession(title: String(text.prefix(80)))
          activeSessionId = created.id
          if title == "New chat" { title = String(text.prefix(80)) }
        }
        _ = try await client.sendMessage(sessionId: activeSessionId, content: text)
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
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    messages.count + toolEvents.count
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    if indexPath.row < messages.count {
      let cell = tableView.dequeueReusableCell(withIdentifier: MessageCell.reuseID, for: indexPath) as! MessageCell
      cell.configure(with: messages[indexPath.row])
      cell.onLongPress = { [weak self] text in self?.showMessageActions(text) }
      return cell
    } else {
      let cell = tableView.dequeueReusableCell(withIdentifier: ToolEventCell.reuseID, for: indexPath) as! ToolEventCell
      cell.configure(with: toolEvents[indexPath.row - messages.count])
      return cell
    }
  }
}

// MARK: - MessageCell

private final class MessageCell: UITableViewCell {
  static let reuseID = "MessageCell"
  var onLongPress: ((String) -> Void)?
  private var rawContent = ""

  private let bubbleStack = UIStackView()
  private let bubble = UIView()
  private let contentStack = UIStackView()
  private let timeLabel = UILabel()
  private var stackLeading: NSLayoutConstraint!
  private var stackTrailing: NSLayoutConstraint!
  private var bubbleMaxWidth: NSLayoutConstraint!

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none

    let longPress = UILongPressGestureRecognizer(target: self, action: #selector(handleLongPress))
    contentView.addGestureRecognizer(longPress)

    bubble.layer.cornerRadius = 18
    bubble.layer.cornerCurve = .continuous
    bubble.clipsToBounds = true

    contentStack.axis = .vertical
    contentStack.spacing = 0
    bubble.addSubview(contentStack)
    contentStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      contentStack.topAnchor.constraint(equalTo: bubble.topAnchor),
      contentStack.leadingAnchor.constraint(equalTo: bubble.leadingAnchor),
      contentStack.trailingAnchor.constraint(equalTo: bubble.trailingAnchor),
      contentStack.bottomAnchor.constraint(equalTo: bubble.bottomAnchor),
    ])

    timeLabel.font = UIFont.preferredFont(forTextStyle: .caption2)
    timeLabel.textColor = .tertiaryLabel
    timeLabel.adjustsFontForContentSizeCategory = true

    bubbleStack.axis = .vertical
    bubbleStack.spacing = 3
    bubbleStack.addArrangedSubview(bubble)
    bubbleStack.addArrangedSubview(timeLabel)

    contentView.addSubview(bubbleStack)
    bubbleStack.translatesAutoresizingMaskIntoConstraints = false

    stackLeading = bubbleStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16)
    stackTrailing = bubbleStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16)

    bubbleMaxWidth = bubbleStack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.82)
    NSLayoutConstraint.activate([
      bubbleStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 3),
      bubbleStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -3),
    ])
    bubbleMaxWidth.isActive = true
  }

  required init?(coder: NSCoder) { fatalError() }

  @objc private func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
    guard gesture.state == .began else { return }
    onLongPress?(rawContent)
  }

  func configure(with message: ChatMessage) {
    rawContent = message.content
    let isUser = message.role == "user"
    let baseFont = UIFont.preferredFont(forTextStyle: .callout)
    let codeBg = UIColor.label.withAlphaComponent(0.08)
    let textColor: UIColor = isUser ? AppTheme.primaryText : .label

    // User keeps a bubble; assistant renders full-width on the canvas.
    bubble.backgroundColor = isUser ? AppTheme.primary : .clear

    contentStack.arrangedSubviews.forEach {
      contentStack.removeArrangedSubview($0); $0.removeFromSuperview()
    }
    for segment in parseMessageSegments(message.content) {
      switch segment {
      case .text(let str): contentStack.addArrangedSubview(makeTextSegment(str, font: baseFont, textColor: textColor, codeBg: codeBg, hInset: isUser ? 14 : 0))
      case .code(let code): contentStack.addArrangedSubview(makeCodeSegment(code, textColor: textColor))
      }
    }

    if let epoch = message.createdAt {
      timeLabel.text = messageTime(epoch)
      timeLabel.textAlignment = isUser ? .right : .left
      timeLabel.isHidden = false
    } else {
      timeLabel.isHidden = true
    }

    // Width: user bubble is capped (right-aligned via leading-inactive + trailing + width cap);
    // assistant spans full width (leading + trailing both active, no width cap) so the label wraps
    // against the screen margins instead of reporting an unwrapped intrinsic width.
    bubbleMaxWidth.isActive = isUser
    stackTrailing.isActive = true
    stackLeading.isActive = !isUser
  }

  private func makeTextSegment(_ text: String, font: UIFont, textColor: UIColor, codeBg: UIColor, hInset: CGFloat = 14) -> UIView {
    let label = UILabel()
    label.numberOfLines = 0
    label.font = font
    label.adjustsFontForContentSizeCategory = true
    label.attributedText = applyInlineMarkdown(text, font: font, color: textColor, codeBg: codeBg)

    let wrapper = UIView()
    wrapper.addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      label.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: hInset),
      label.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -hInset),
      label.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 10),
      label.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -10),
    ])
    return wrapper
  }

  private func makeCodeSegment(_ code: String, textColor: UIColor) -> UIView {
    let container = UIView()
    container.backgroundColor = UIColor.label.withAlphaComponent(0.1)

    let scrollView = UIScrollView()
    scrollView.showsHorizontalScrollIndicator = true
    scrollView.showsVerticalScrollIndicator = false
    scrollView.alwaysBounceHorizontal = false

    let codeLabel = UILabel()
    codeLabel.numberOfLines = 0
    codeLabel.lineBreakMode = .byClipping
    codeLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    codeLabel.text = code
    codeLabel.textColor = textColor

    scrollView.addSubview(codeLabel)
    codeLabel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      codeLabel.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 14),
      codeLabel.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 10),
      codeLabel.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -10),
      codeLabel.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -14),
      scrollView.frameLayoutGuide.heightAnchor.constraint(equalTo: scrollView.contentLayoutGuide.heightAnchor),
    ])

    container.addSubview(scrollView)
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      scrollView.topAnchor.constraint(equalTo: container.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])

    return container
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

// MARK: - ToolEventCell

private final class ToolEventCell: UITableViewCell {
  static let reuseID = "ToolEventCell"

  private let pill = UIView()
  private let iconView = UIImageView()
  private let nameLabel = UILabel()
  private let statusLabel = UILabel()
  private let outputLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    buildLayout()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func buildLayout() {
    pill.layer.cornerRadius = 8
    pill.layer.cornerCurve = .continuous
    pill.layer.borderWidth = 0.5

    iconView.contentMode = .scaleAspectFit
    iconView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      iconView.widthAnchor.constraint(equalToConstant: 15),
      iconView.heightAnchor.constraint(equalToConstant: 15),
    ])

    nameLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
    nameLabel.textColor = .label

    spinner.hidesWhenStopped = true
    spinner.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)

    statusLabel.font = UIFont.preferredFont(forTextStyle: .caption2)
    statusLabel.textColor = .tertiaryLabel

    let headerRow = UIStackView(arrangedSubviews: [iconView, nameLabel, UIView(), spinner, statusLabel])
    headerRow.axis = .horizontal
    headerRow.alignment = .center
    headerRow.spacing = 6

    outputLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    outputLabel.textColor = .secondaryLabel
    outputLabel.numberOfLines = 5
    outputLabel.isHidden = true

    let stack = UIStackView(arrangedSubviews: [headerRow, outputLabel])
    stack.axis = .vertical
    stack.spacing = 6
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)

    pill.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: pill.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: pill.trailingAnchor),
      stack.topAnchor.constraint(equalTo: pill.topAnchor),
      stack.bottomAnchor.constraint(equalTo: pill.bottomAnchor),
    ])

    contentView.addSubview(pill)
    pill.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      pill.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      pill.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -16),
      pill.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      pill.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
  }

  func configure(with event: ToolEvent) {
    let name = event.tool.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    nameLabel.text = name

    switch event.status {
    case "running":
      iconView.image = UIImage(systemName: "gear")
      iconView.tintColor = AppTheme.accent
      pill.backgroundColor = AppTheme.surface
      pill.layer.borderColor = AppTheme.border.cgColor
      spinner.startAnimating()
      statusLabel.text = nil
    case "done":
      iconView.image = UIImage(systemName: "checkmark.circle.fill")
      iconView.tintColor = .systemGreen
      pill.backgroundColor = UIColor.systemGreen.withAlphaComponent(0.06)
      pill.layer.borderColor = UIColor.systemGreen.withAlphaComponent(0.25).cgColor
      spinner.stopAnimating()
      statusLabel.text = "done"
    case "error":
      iconView.image = UIImage(systemName: "xmark.circle.fill")
      iconView.tintColor = .systemRed
      pill.backgroundColor = UIColor.systemRed.withAlphaComponent(0.06)
      pill.layer.borderColor = UIColor.systemRed.withAlphaComponent(0.25).cgColor
      spinner.stopAnimating()
      statusLabel.text = "error"
    default:
      iconView.image = UIImage(systemName: "gear")
      iconView.tintColor = .secondaryLabel
      pill.backgroundColor = AppTheme.surface
      pill.layer.borderColor = AppTheme.border.cgColor
      spinner.stopAnimating()
      statusLabel.text = nil
    }

    let output = event.output.trimmingCharacters(in: .whitespacesAndNewlines)
    let display = output.isEmpty ? (event.result?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") : output
    if display.isEmpty {
      outputLabel.isHidden = true
    } else {
      outputLabel.text = display
      outputLabel.isHidden = false
    }
  }
}
