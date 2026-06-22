import UIKit
import UniformTypeIdentifiers

final class ChatViewController: UIViewController {
  var onOpenSidebar: (() -> Void)?
  var onDeleted: (() -> Void)?
  private let isNew: Bool
  private let appSession: AppSession
  private let chatSession: ChatSession
  /// The session id messages/polling/websocket actually operate against.
  /// Starts equal to `chatSession.id`, but gets populated once a brand-new
  /// chat (empty id) is lazily created on first send.
  private var activeSessionId: String
  private lazy var client = APIClient(session: appSession)
  private var currentEffort: String
  private var currentModel: String?
  /// Populated as model lists are fetched for the options menu, so the
  /// composer pill can show "Sonnet 4.6" instead of a raw model id.
  private var modelDisplayNames: [String: String] = [:]
  /// Stored independently of `UIViewController.title`/`navigationItem.title`
  /// since the chat header no longer displays a title at all.
  private var chatTitle: String

  private var messages: [ChatMessage] = []
  private var toolEvents: [ToolEvent] = []
  private var wsSubscriptionId: UUID?
  private var isLoaded = false

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()
  private let composeBar = UIView()
  /// Gap between the floating composer card and the bottom safe area (or the
  /// keyboard, once it's up). Kept as a constant since both the resting
  /// constraint and the keyboard handler need to agree on it.
  private let composeFloatingGap: CGFloat = 8
  private let textView = ComposerTextView()
  private let sendButton = UIButton(type: .system)
  private let sendActivity = UIActivityIndicatorView(style: .medium)
  /// Effort/model picker pinned to the composer's toolbar row, mirroring the
  /// web app's ChatConfigPopover placement (it used to live in the nav bar).
  private let configPill = UIButton(type: .system)
  private let attachButton = UIButton(type: .system)
  private let micButton = UIButton(type: .system)
  private let attachmentsScroll = UIScrollView()
  private let attachmentsStack = UIStackView()
  private var attachmentsRow: UIStackView!
  private var pendingAttachments: [PendingAttachment] = []
  private let maxAttachments = 8
  private let maxAttachmentBytes = 10 * 1024 * 1024
  private let dictation = SpeechDictationController()
  private var isDictating = false
  private var dictationBaseText = ""
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
    self.currentEffort = chatSession.effort ?? "medium"
    self.currentModel = chatSession.model
    self.chatTitle = isNew ? "New chat" : (chatSession.title ?? "Chat")
    super.init(nibName: nil, bundle: nil)
    hidesBottomBarWhenPushed = true
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    updateSidebarButtonVisibility()
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
    view.backgroundColor = .systemBackground

    // The chat header carries no title text or hairline — just the sidebar
    // and options controls floating over the conversation.
    navigationItem.largeTitleDisplayMode = .never
    hideNavBarHairline()
    updateSidebarButtonVisibility()
    let optionsButton = UIBarButtonItem(image: UIImage(systemName: "ellipsis.circle"), menu: makeChatSettingsMenu())
    optionsButton.tintColor = AppPalette.accent
    navigationItem.rightBarButtonItem = optionsButton

    setupTable()
    setupAgentStatusBar()
    setupComposeBar()
    setupReconnectBanner()
    observeKeyboard()
    loadMessages()
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    updateSidebarButtonVisibility()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    updateSidebarButtonVisibility()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    // The composer floats over the table view now, so its inset has to be
    // measured each layout pass (text growth, keyboard, agent status row)
    // instead of being a fixed constant.
    let bottomInset = view.bounds.height - composeBar.frame.minY + 8
    if tableView.contentInset.bottom != bottomInset {
      tableView.contentInset.bottom = bottomInset
      tableView.verticalScrollIndicatorInsets.bottom = bottomInset
    }
  }

  deinit {
    pollTimer?.invalidate()
    if let id = wsSubscriptionId { WebSocketService.shared.unsubscribe(id) }
    NotificationCenter.default.removeObserver(self)
  }

  /// On iPhone (collapsed split view) the system back chevron returns to the
  /// sidebar, so the custom sidebar toggle is only useful on expanded iPad.
  private func updateSidebarButtonVisibility() {
    guard splitViewController?.isCollapsed == false else {
      navigationItem.leftBarButtonItem = nil
      return
    }
    let button = UIBarButtonItem(
      image: UIImage(systemName: "sidebar.left"),
      style: .plain, target: self, action: #selector(openSidebarTapped))
    button.tintColor = AppPalette.accent
    navigationItem.leftBarButtonItem = button
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
      messages[idx] = ChatMessage(id: old.id, role: old.role, content: old.content + delta, createdAt: old.createdAt, attachments: old.attachments)
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
      chatTitle = t

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
    agentStatusBar.backgroundColor = .secondarySystemBackground
    agentStatusBar.clipsToBounds = true

    let border = UIView()
    border.backgroundColor = .separator
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

    agentStatusLabel.font = UIFont.app(forTextStyle: .footnote)
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
    reconnectBanner.backgroundColor = .systemOrange.withAlphaComponent(0.9)
    reconnectBanner.clipsToBounds = true

    let label = UILabel()
    label.text = "Reconnecting…"
    label.font = UIFont.app(forTextStyle: .caption1)
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
    composeBar.backgroundColor = AppPalette.card
    composeBar.layer.cornerRadius = 18
    composeBar.layer.borderWidth = 1
    composeBar.layer.borderColor = AppPalette.inputBorder.cgColor
    composeBar.layer.shadowColor = UIColor.black.cgColor
    composeBar.layer.shadowOpacity = 0.08
    composeBar.layer.shadowRadius = 12
    composeBar.layer.shadowOffset = CGSize(width: 0, height: 4)

    textView.placeholder = "Message..."

    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .medium
    sendButton.configuration?.baseBackgroundColor = AppPalette.accent
    sendButton.configuration?.baseForegroundColor = AppPalette.accentForeground
    sendButton.configuration?.image = UIImage(systemName: "arrow.up")
    sendButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
    sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
    NSLayoutConstraint.activate([
      sendButton.widthAnchor.constraint(equalToConstant: 32),
      sendButton.heightAnchor.constraint(equalToConstant: 32),
    ])

    sendActivity.hidesWhenStopped = true

    configPill.configuration = .gray()
    configPill.configuration?.cornerStyle = .medium
    configPill.configuration?.baseForegroundColor = AppPalette.foregroundSoft
    configPill.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 5, leading: 10, bottom: 5, trailing: 10)
    configPill.menu = makeConfigMenu()
    configPill.showsMenuAsPrimaryAction = true
    refreshConfigPill()

    attachButton.configuration = .plain()
    attachButton.configuration?.image = UIImage(systemName: "paperclip")
    attachButton.configuration?.baseForegroundColor = AppPalette.foregroundSoft
    attachButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
    attachButton.addTarget(self, action: #selector(attachTapped), for: .touchUpInside)
    NSLayoutConstraint.activate([
      attachButton.widthAnchor.constraint(equalToConstant: 32),
      attachButton.heightAnchor.constraint(equalToConstant: 32),
    ])

    micButton.configuration = .plain()
    micButton.configuration?.image = UIImage(systemName: "mic")
    micButton.configuration?.baseForegroundColor = AppPalette.foregroundSoft
    micButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 6, bottom: 6, trailing: 6)
    micButton.addTarget(self, action: #selector(micTapped), for: .touchUpInside)
    NSLayoutConstraint.activate([
      micButton.widthAnchor.constraint(equalToConstant: 32),
      micButton.heightAnchor.constraint(equalToConstant: 32),
    ])

    attachmentsStack.axis = .horizontal
    attachmentsStack.spacing = 6
    attachmentsScroll.addSubview(attachmentsStack)
    attachmentsScroll.showsHorizontalScrollIndicator = false
    attachmentsStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      attachmentsStack.leadingAnchor.constraint(equalTo: attachmentsScroll.contentLayoutGuide.leadingAnchor),
      attachmentsStack.trailingAnchor.constraint(equalTo: attachmentsScroll.contentLayoutGuide.trailingAnchor),
      attachmentsStack.topAnchor.constraint(equalTo: attachmentsScroll.contentLayoutGuide.topAnchor),
      attachmentsStack.bottomAnchor.constraint(equalTo: attachmentsScroll.contentLayoutGuide.bottomAnchor),
      attachmentsStack.heightAnchor.constraint(equalTo: attachmentsScroll.frameLayoutGuide.heightAnchor),
    ])
    let attachmentsRow = UIStackView(arrangedSubviews: [attachmentsScroll])
    attachmentsRow.isLayoutMarginsRelativeArrangement = true
    attachmentsRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 6, leading: 14, bottom: 0, trailing: 14)
    NSLayoutConstraint.activate([
      attachmentsScroll.heightAnchor.constraint(equalToConstant: 28),
    ])
    attachmentsRow.isHidden = true

    let textRow = UIStackView(arrangedSubviews: [textView])
    textRow.isLayoutMarginsRelativeArrangement = true
    textRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 4, leading: 16, bottom: 0, trailing: 16)

    let toolbarLeading = UIStackView(arrangedSubviews: [attachButton, configPill])
    toolbarLeading.axis = .horizontal
    toolbarLeading.alignment = .center
    toolbarLeading.spacing = 4

    let toolbarSpacer = UIView()
    let toolbarRow = UIStackView(arrangedSubviews: [toolbarLeading, toolbarSpacer, micButton, sendActivity, sendButton])
    toolbarRow.axis = .horizontal
    toolbarRow.alignment = .center
    toolbarRow.spacing = 6
    toolbarRow.isLayoutMarginsRelativeArrangement = true
    toolbarRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 10, bottom: 8, trailing: 10)

    let column = UIStackView(arrangedSubviews: [attachmentsRow, textRow, toolbarRow])
    column.axis = .vertical
    column.spacing = 4
    self.attachmentsRow = attachmentsRow

    composeBar.addSubview(column)
    column.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      column.leadingAnchor.constraint(equalTo: composeBar.leadingAnchor),
      column.trailingAnchor.constraint(equalTo: composeBar.trailingAnchor),
      column.topAnchor.constraint(equalTo: composeBar.topAnchor),
      column.bottomAnchor.constraint(equalTo: composeBar.bottomAnchor),
    ])

    view.addSubview(composeBar)
    composeBar.translatesAutoresizingMaskIntoConstraints = false
    composeBarBottom = composeBar.bottomAnchor.constraint(
      equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -composeFloatingGap)

    NSLayoutConstraint.activate([
      // Full-bleed top-to-bottom so messages scroll visibly underneath the
      // transparent nav bar and the floating composer card, rather than
      // stopping at a hard edge that reveals the plain page background.
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      agentStatusBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      agentStatusBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      agentStatusBar.bottomAnchor.constraint(equalTo: composeBar.topAnchor, constant: -8),
      composeBar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
      composeBar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
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
    // The resting constraint already floats the card above the bottom safe
    // area; the keyboard only needs to push it up by however much it covers
    // beyond that inset.
    let keyboardRise = max(0, overlap - view.safeAreaInsets.bottom)
    UIView.animate(withDuration: duration) {
      self.composeBarBottom.constant = -self.composeFloatingGap - keyboardRise
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
      title.font = UIFont.app(forTextStyle: .headline)
      title.textAlignment = .center
      let sub = UILabel()
      sub.text = "Send a message below."
      sub.font = UIFont.app(forTextStyle: .subheadline)
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

  /// Effort/model only — the composer pill's menu. Quick, frequent toggles
  /// live here; anything that touches the chat as a whole (rename, delete)
  /// belongs in `makeChatSettingsMenu` instead.
  private func makeConfigMenu() -> UIMenu {
    guard !activeSessionId.isEmpty else {
      return UIMenu(children: [])
    }
    let effortMenu = UIMenu(title: "Effort", image: UIImage(systemName: "gauge.with.dots.needle.50percent"), options: .displayInline, children:
      ["low", "medium", "high"].map { level in
        UIAction(title: level.capitalized, state: level == currentEffort ? .on : .off) { [weak self] _ in
          self?.setEffort(level)
        }
      })

    let modelMenu = UIDeferredMenuElement.uncached { [weak self] completion in
      guard let self else { completion([]); return }
      Task {
        let models = (try? await self.client.modelsForEffort(self.currentEffort)) ?? []
        for info in models { self.modelDisplayNames[info.id] = info.displayName }
        self.refreshConfigPill()
        let autoAction = UIAction(title: "Auto", state: self.currentModel == nil ? .on : .off) { [weak self] _ in
          self?.setModel(nil)
        }
        let modelActions = models.map { info in
          UIAction(title: info.displayName, state: info.id == self.currentModel ? .on : .off) { [weak self] _ in
            self?.setModel(info.id)
          }
        }
        completion([autoAction] + modelActions)
      }
    }
    let modelSubmenu = UIMenu(title: "Model", image: UIImage(systemName: "cpu"), children: [modelMenu])

    return UIMenu(children: [effortMenu, modelSubmenu])
  }

  /// Nav-bar ellipsis menu — chat-level settings rather than per-message
  /// config, so it includes Rename/Delete alongside the same effort/model
  /// effort/model live on the composer pill instead — this menu is just
  /// chat-level actions.
  private func makeChatSettingsMenu() -> UIMenu {
    guard !activeSessionId.isEmpty else {
      return UIMenu(children: [])
    }
    let renameAction = UIAction(title: "Rename Chat", image: UIImage(systemName: "pencil")) { [weak self] _ in
      self?.promptRename()
    }
    let deleteAction = UIAction(title: "Delete Chat", image: UIImage(systemName: "trash"), attributes: .destructive) { [weak self] _ in
      self?.confirmDeleteChat()
    }
    return UIMenu(children: [renameAction, UIMenu(options: .displayInline, children: [deleteAction])])
  }

  private func refreshOptionsMenu() {
    navigationItem.rightBarButtonItem?.menu = makeChatSettingsMenu()
    configPill.menu = makeConfigMenu()
    refreshConfigPill()
  }

  private func refreshConfigPill() {
    let modelLabel = currentModel.flatMap { modelDisplayNames[$0] } ?? currentModel ?? "Auto"
    let label = "\(currentEffort.capitalized) · \(modelLabel)"
    var config = configPill.configuration
    config?.attributedTitle = AttributedString(label, attributes: AttributeContainer([.font: UIFont.app(forTextStyle: .caption1)]))
    config?.image = nil
    configPill.configuration = config
  }

  private func confirmDeleteChat() {
    let alert = UIAlertController(title: "Delete Chat?", message: "This can't be undone.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
      guard let self, !self.activeSessionId.isEmpty else { return }
      Task {
        try? await self.client.deleteSession(id: self.activeSessionId)
        self.onDeleted?()
      }
    })
    present(alert, animated: true)
  }

  private func setEffort(_ effort: String) {
    let previous = currentEffort
    currentEffort = effort
    refreshOptionsMenu()
    Task {
      do {
        try await client.updateSessionConfig(id: activeSessionId, effort: effort)
      } catch {
        currentEffort = previous
        refreshOptionsMenu()
        showError(error)
      }
    }
  }

  private func setModel(_ model: String?) {
    let previous = currentModel
    currentModel = model
    refreshOptionsMenu()
    Task {
      do {
        try await client.updateSessionConfig(id: activeSessionId, model: model)
      } catch {
        currentModel = previous
        refreshOptionsMenu()
        showError(error)
      }
    }
  }

  private func promptRename() {
    let alert = UIAlertController(title: "Rename Chat", message: nil, preferredStyle: .alert)
    alert.addTextField { field in
      field.text = self.chatTitle
      field.placeholder = "Chat title"
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self, weak alert] _ in
      guard let self, let text = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return }
      self.chatTitle = text
      Task {
        try? await self.client.updateSessionConfig(id: self.activeSessionId, title: text)
      }
    })
    present(alert, animated: true)
  }

  @objc private func refreshPulled() {
    Task {
      await reloadMessages()
      refreshControl.endRefreshing()
    }
  }

  @objc private func sendTapped() {
    let text = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty || !pendingAttachments.isEmpty else { return }
    if isDictating { stopDictation() }

    let attachmentsToSend = pendingAttachments
    textView.text = ""
    clearAttachments()
    setSending(true)
    setAgentStatus("Working…")

    let optimistic = ChatMessage(id: UUID().uuidString, role: "user", content: text, createdAt: nil, attachments: nil)
    messages.append(optimistic)
    let ip = IndexPath(row: messages.count - 1, section: 0)
    tableView.insertRows(at: [ip], with: .automatic)
    scrollToBottom(animated: true)

    Task {
      do {
        if activeSessionId.isEmpty {
          let created = try await client.createSession(title: String(text.prefix(80)))
          activeSessionId = created.id
          if chatTitle == "New chat" { chatTitle = String(text.prefix(80)) }
          refreshOptionsMenu()
        }
        _ = try await client.sendMessage(sessionId: activeSessionId, content: text, attachments: attachmentsToSend)
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
        pendingAttachments = attachmentsToSend
        refreshAttachmentsUI()
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

  // MARK: - Attachments

  @objc private func attachTapped() {
    guard pendingAttachments.count < maxAttachments else {
      showError(NSError(domain: "Unnamed", code: 0, userInfo: [NSLocalizedDescriptionKey: "Attach up to \(maxAttachments) files."]))
      return
    }
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
    picker.allowsMultipleSelection = true
    picker.delegate = self
    present(picker, animated: true)
  }

  private func addAttachments(from urls: [URL]) {
    let available = maxAttachments - pendingAttachments.count
    guard available > 0 else { return }
    for url in urls.prefix(available) {
      guard let data = try? Data(contentsOf: url), data.count <= maxAttachmentBytes else { continue }
      let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
      pendingAttachments.append(PendingAttachment(filename: url.lastPathComponent, mimeType: mimeType, data: data))
    }
    refreshAttachmentsUI()
  }

  private func removeAttachment(at index: Int) {
    guard pendingAttachments.indices.contains(index) else { return }
    pendingAttachments.remove(at: index)
    refreshAttachmentsUI()
  }

  private func clearAttachments() {
    pendingAttachments = []
    refreshAttachmentsUI()
  }

  private func refreshAttachmentsUI() {
    attachmentsStack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    for (index, attachment) in pendingAttachments.enumerated() {
      attachmentsStack.addArrangedSubview(makeAttachmentChip(attachment, index: index))
    }
    attachmentsRow.isHidden = pendingAttachments.isEmpty
  }

  private func makeAttachmentChip(_ attachment: PendingAttachment, index: Int) -> UIView {
    var config = UIButton.Configuration.gray()
    config.cornerStyle = .capsule
    config.baseForegroundColor = AppPalette.foregroundSoft
    config.image = UIImage(systemName: "xmark.circle.fill")
    config.imagePlacement = .trailing
    config.imagePadding = 4
    config.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 10, bottom: 4, trailing: 8)
    config.attributedTitle = AttributedString(
      attachment.filename, attributes: AttributeContainer([.font: UIFont.app(forTextStyle: .caption2)]))
    config.titleLineBreakMode = .byTruncatingMiddle
    let button = UIButton(configuration: config)
    button.tag = index
    button.addAction(UIAction { [weak self] _ in self?.removeAttachment(at: index) }, for: .touchUpInside)
    return button
  }

  // MARK: - Voice dictation

  @objc private func micTapped() {
    isDictating ? stopDictation() : startDictation()
  }

  private func startDictation() {
    dictationBaseText = textView.text
    dictation.onTranscript = { [weak self] transcript in
      guard let self else { return }
      let base = self.dictationBaseText.trimmingCharacters(in: .whitespacesAndNewlines)
      self.textView.text = base.isEmpty ? transcript : "\(base) \(transcript)"
    }
    dictation.onError = { [weak self] error in
      self?.isDictating = false
      self?.updateMicButtonState()
      self?.showError(error)
    }
    dictation.onEnd = { [weak self] in
      self?.isDictating = false
      self?.updateMicButtonState()
    }
    dictation.start()
    isDictating = true
    updateMicButtonState()
  }

  private func stopDictation() {
    dictation.stop()
    isDictating = false
    updateMicButtonState()
  }

  private func updateMicButtonState() {
    micButton.configuration?.image = UIImage(systemName: isDictating ? "mic.fill" : "mic")
    micButton.configuration?.baseForegroundColor = isDictating ? AppPalette.destructive : AppPalette.foregroundSoft
  }
}

extension ChatViewController: UIDocumentPickerDelegate {
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    addAttachments(from: urls)
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

// MARK: - Bubble shape

/// A view that can mask its corners with independent radii per corner —
/// UIKit's `maskedCorners` only varies *which* corners round, not by how
/// much, but the web bubble (`rounded-[18px] rounded-tr-md`) needs both.
private final class CornerMaskedView: UIView {
  var cornerRadii: (topLeft: CGFloat, topRight: CGFloat, bottomLeft: CGFloat, bottomRight: CGFloat) = (18, 18, 18, 18) {
    didSet { setNeedsLayout() }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let r = cornerRadii
    let path = UIBezierPath()
    let w = bounds.width, h = bounds.height
    path.move(to: CGPoint(x: r.topLeft, y: 0))
    path.addLine(to: CGPoint(x: w - r.topRight, y: 0))
    path.addArc(withCenter: CGPoint(x: w - r.topRight, y: r.topRight), radius: r.topRight, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
    path.addLine(to: CGPoint(x: w, y: h - r.bottomRight))
    path.addArc(withCenter: CGPoint(x: w - r.bottomRight, y: h - r.bottomRight), radius: r.bottomRight, startAngle: 0, endAngle: .pi / 2, clockwise: true)
    path.addLine(to: CGPoint(x: r.bottomLeft, y: h))
    path.addArc(withCenter: CGPoint(x: r.bottomLeft, y: h - r.bottomLeft), radius: r.bottomLeft, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
    path.addLine(to: CGPoint(x: 0, y: r.topLeft))
    path.addArc(withCenter: CGPoint(x: r.topLeft, y: r.topLeft), radius: r.topLeft, startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
    path.close()
    let mask = CAShapeLayer()
    mask.path = path.cgPath
    layer.mask = mask
  }
}

// MARK: - MessageCell

private final class MessageCell: UITableViewCell {
  static let reuseID = "MessageCell"
  var onLongPress: ((String) -> Void)?
  private var rawContent = ""

  private let bubbleStack = UIStackView()
  private let bubble = CornerMaskedView()
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

    timeLabel.font = UIFont.app(forTextStyle: .caption2)
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
    let baseFont = UIFont.app(forTextStyle: .callout)
    let codeBg = AppPalette.muted
    let textColor: UIColor = isUser ? .label : AppPalette.foregroundSoft

    // User keeps a neutral chip bubble with a squared "tail" corner; assistant
    // renders full-width on the canvas, matching the web app's message list.
    bubble.backgroundColor = isUser ? AppPalette.muted : .clear
    bubble.cornerRadii = isUser ? (18, 6, 18, 18) : (0, 0, 0, 0)

    contentStack.arrangedSubviews.forEach {
      contentStack.removeArrangedSubview($0); $0.removeFromSuperview()
    }
    // Assistant text drops emoji to read like an agent/tool transcript rather
    // than a texting app, matching the web app's stripEmoji behavior.
    let content = isUser ? message.content : stripEmoji(message.content)
    for segment in parseMessageSegments(content) {
      switch segment {
      case .text(let str): contentStack.addArrangedSubview(makeTextSegment(str, font: baseFont, textColor: textColor, codeBg: codeBg, hInset: isUser ? 14 : 0, lineSpacing: isUser ? 0 : 4))
      case .code(let code): contentStack.addArrangedSubview(makeCodeSegment(code))
      }
    }

    // User bubbles skip the timestamp entirely — this is a chat-with-an-agent
    // surface, not a texting app where message timing matters.
    if !isUser, let epoch = message.createdAt {
      timeLabel.text = messageTime(epoch)
      timeLabel.textAlignment = .left
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

  private func makeTextSegment(_ text: String, font: UIFont, textColor: UIColor, codeBg: UIColor, hInset: CGFloat = 14, lineSpacing: CGFloat = 0) -> UIView {
    let label = UILabel()
    label.numberOfLines = 0
    label.font = font
    label.adjustsFontForContentSizeCategory = true
    label.attributedText = markdownAttributedString(text, baseFont: font, textColor: textColor, codeBg: codeBg, lineSpacing: lineSpacing)

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

  private func makeCodeSegment(_ code: String) -> UIView {
    // Code blocks always render GitHub-dark, in both appearances, matching the web app.
    let container = UIView()
    container.backgroundColor = AppPalette.codeBackground
    container.layer.cornerRadius = 12
    container.layer.cornerCurve = .continuous
    container.layer.borderWidth = 1
    container.layer.borderColor = UIColor.white.withAlphaComponent(0.08).cgColor
    container.clipsToBounds = true

    let scrollView = UIScrollView()
    scrollView.showsHorizontalScrollIndicator = true
    scrollView.showsVerticalScrollIndicator = false
    scrollView.alwaysBounceHorizontal = false

    let codeLabel = UILabel()
    codeLabel.numberOfLines = 0
    codeLabel.lineBreakMode = .byClipping
    codeLabel.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    codeLabel.text = code
    codeLabel.textColor = AppPalette.codeForeground

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

  // Matches the web ExecutionCard: a neutral bordered card with a square
  // icon badge, tool name, and a colored status pill on the trailing edge —
  // status drives only the pill, not the whole card.
  private let card = UIView()
  private let badge = UIView()
  private let iconView = UIImageView()
  private let nameLabel = UILabel()
  private let pill = UIView()
  private let pillIcon = UIImageView()
  private let pillLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let outputLabel = UILabel()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    buildLayout()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func buildLayout() {
    card.backgroundColor = .systemBackground
    card.layer.cornerRadius = 10
    card.layer.cornerCurve = .continuous
    card.layer.borderWidth = 1
    card.layer.borderColor = AppPalette.borderSoft.cgColor

    badge.backgroundColor = AppPalette.muted
    badge.layer.cornerRadius = 6
    badge.layer.cornerCurve = .continuous
    badge.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      badge.widthAnchor.constraint(equalToConstant: 26),
      badge.heightAnchor.constraint(equalToConstant: 26),
    ])

    iconView.contentMode = .scaleAspectFit
    badge.addSubview(iconView)
    iconView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      iconView.centerXAnchor.constraint(equalTo: badge.centerXAnchor),
      iconView.centerYAnchor.constraint(equalTo: badge.centerYAnchor),
      iconView.widthAnchor.constraint(equalToConstant: 13),
      iconView.heightAnchor.constraint(equalToConstant: 13),
    ])

    nameLabel.font = UIFont.app(forTextStyle: .footnote).withWeight(.medium)
    nameLabel.textColor = .label

    spinner.hidesWhenStopped = true
    spinner.transform = CGAffineTransform(scaleX: 0.55, y: 0.55)

    pillIcon.contentMode = .scaleAspectFit
    pillIcon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      pillIcon.widthAnchor.constraint(equalToConstant: 10),
      pillIcon.heightAnchor.constraint(equalToConstant: 10),
    ])
    pillLabel.font = UIFont.app(forTextStyle: .caption2).withWeight(.medium)

    let pillRow = UIStackView(arrangedSubviews: [spinner, pillIcon, pillLabel])
    pillRow.axis = .horizontal
    pillRow.alignment = .center
    pillRow.spacing = 4
    pillRow.isLayoutMarginsRelativeArrangement = true
    pillRow.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 3, leading: 8, bottom: 3, trailing: 8)
    pill.layer.cornerRadius = 9
    pill.addSubview(pillRow)
    pillRow.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      pillRow.leadingAnchor.constraint(equalTo: pill.leadingAnchor),
      pillRow.trailingAnchor.constraint(equalTo: pill.trailingAnchor),
      pillRow.topAnchor.constraint(equalTo: pill.topAnchor),
      pillRow.bottomAnchor.constraint(equalTo: pill.bottomAnchor),
    ])

    let headerRow = UIStackView(arrangedSubviews: [badge, nameLabel, UIView(), pill])
    headerRow.axis = .horizontal
    headerRow.alignment = .center
    headerRow.spacing = 9

    outputLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    outputLabel.textColor = .secondaryLabel
    outputLabel.numberOfLines = 5
    outputLabel.isHidden = true

    let stack = UIStackView(arrangedSubviews: [headerRow, outputLabel])
    stack.axis = .vertical
    stack.spacing = 8
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 11, leading: 13, bottom: 11, trailing: 13)

    card.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      stack.topAnchor.constraint(equalTo: card.topAnchor),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
    ])

    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor, constant: -48),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
  }

  func configure(with event: ToolEvent) {
    let name = event.tool.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    nameLabel.text = name
    iconView.image = UIImage(systemName: "wrench.and.screwdriver")
    iconView.tintColor = .secondaryLabel

    switch event.status {
    case "running":
      pill.backgroundColor = AppPalette.accent.withAlphaComponent(0.14)
      pillLabel.textColor = AppPalette.accent
      pillLabel.text = "Running"
      pillIcon.isHidden = true
      spinner.isHidden = false
      spinner.color = AppPalette.accent
      spinner.startAnimating()
    case "done":
      pill.backgroundColor = AppPalette.success.withAlphaComponent(0.14)
      pillLabel.textColor = AppPalette.success
      pillLabel.text = "Done"
      pillIcon.image = UIImage(systemName: "checkmark")
      pillIcon.tintColor = AppPalette.success
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
    case "error":
      pill.backgroundColor = AppPalette.destructive.withAlphaComponent(0.12)
      pillLabel.textColor = AppPalette.destructive
      pillLabel.text = "Error"
      pillIcon.image = UIImage(systemName: "exclamationmark.circle")
      pillIcon.tintColor = AppPalette.destructive
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
    default:
      pill.backgroundColor = AppPalette.muted
      pillLabel.textColor = .secondaryLabel
      pillLabel.text = "Pending"
      pillIcon.image = UIImage(systemName: "circle.fill")
      pillIcon.tintColor = .secondaryLabel
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
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
