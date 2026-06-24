import UIKit
import UniformTypeIdentifiers

private enum ChatRenderItem {
  case message(ChatMessage)
  case tool(ToolEvent)
  case toolGroup([ToolEvent])
  case event(SessionEvent)
  case plan(SessionEvent)
  case artifact(ArtifactSummary)
}

private struct ArtifactSummary {
  let id: String
  let projectId: String
  let title: String
  let subtitle: String
  let status: String
  let contentURL: String?
  let pathOrURL: String?
}

final class ChatViewController: UIViewController {
  var onOpenSidebar: (() -> Void)?
  var onDeleted: (() -> Void)?
  var onNewChat: (() -> Void)?
  var onShowSettings: (() -> Void)?
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
  private var sessionEvents: [SessionEvent] = []
  private var renderItems: [ChatRenderItem] = []
  private var worktree: SessionWorktree?
  private var expandedToolIds = Set<String>()
  private var planCache: [String: PlanDetailResult] = [:]
  private var artifactCache: [String: ProjectArtifact] = [:]
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

    navigationItem.largeTitleDisplayMode = .never
    removeNavBarBackground()
    updateSidebarButtonVisibility()
    let optionsButton = UIBarButtonItem(image: UIImage(systemName: "ellipsis.circle"), menu: makeChatSettingsMenu())
    optionsButton.tintColor = AppPalette.accent
    navigationItem.rightBarButtonItem = optionsButton

    setupTable()
    setupAgentStatusBar()
    setupComposeBar()
    setupReconnectBanner()
    observeKeyboard()
    observeForeground()
    loadMessages()
    Task { await refreshStatus() }
    Task { await refreshWorktree() }
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
      Task { await self.pollMessagesAndStatus() }
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
      reloadTimeline()
      if isNearBottom() { scrollToBottom(animated: true) }

    case .messageDelta(let sid, let messageId, let delta) where sid == activeSessionId:
      guard let idx = messages.firstIndex(where: { $0.id == messageId }) else { return }
      let old = messages[idx]
      messages[idx] = ChatMessage(id: old.id, role: old.role, content: old.content + delta, createdAt: old.createdAt, attachments: old.attachments, executions: old.executions)
      reloadTimeline()
      if isNearBottom() { scrollToBottom(animated: false) }

    case .messageCreated(let sid, let message) where sid == activeSessionId:
      if let idx = messages.firstIndex(where: { $0.id == message.id }) {
        messages[idx] = message
      } else {
        messages.append(message)
      }
      reloadTimeline()
      if isNearBottom() { scrollToBottom(animated: true) }

    case .turnComplete(let sid, _) where sid == activeSessionId:
      setAgentStatus(nil)
      setSending(false)
      // Finalize any still-running tool events
      for i in toolEvents.indices where toolEvents[i].status == "running" {
        toolEvents[i].status = "done"
      }
      reloadTimeline()
      Task {
        await reloadMessages()
        await refreshEvents()
        await refreshWorktree()
      }

    case .executionUpdate(let sid, let executionId, let tool, let status, let chunk, let result)
        where sid == activeSessionId:
      handleExecutionUpdate(executionId: executionId, tool: tool, status: status, chunk: chunk, result: result)

    case .approvalRequested(let sid, let executionId, _, let action)
        where sid == nil || sid == activeSessionId:
      setAgentStatus("Waiting for approval...")
      if !toolEvents.contains(where: { $0.executionId == executionId }) {
        toolEvents.append(ToolEvent(executionId: executionId, tool: action, projectName: nil, status: "awaiting_approval", action: action))
        reloadTimeline()
      } else {
        updateToolEvent(executionId: executionId) { $0.status = "awaiting_approval" }
      }

    case .sessionEventCreated(let sid, let event) where sid == activeSessionId:
      if !sessionEvents.contains(where: { $0.id == event.id }) {
        sessionEvents.append(event)
        reloadTimeline()
      }
      if event.type == "artifact_created" || event.type == "plan_created" {
        Task {
          await refreshEvents()
          await refreshWorktree()
        }
      }

    case .sessionTitleUpdated(let sid, let t) where sid == activeSessionId:
      chatTitle = t

    case .connected:
      pendingBannerItem?.cancel()
      pendingBannerItem = nil
      hideReconnectBanner()
      Task { await refreshRecoveryState() }

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
    let stripped = raw.hasPrefix("invoke_") ? String(raw.dropFirst(7)) : raw
    return stripped.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
  }

  private func handleExecutionUpdate(executionId: String, tool: String?, status: String?, chunk: String?, result: String?) {
    if let status {
      switch status {
      case "running":
        let name = tool.map { formatToolName($0) } ?? "Working"
        setAgentStatus("\(name)…")
        if !toolEvents.contains(where: { $0.executionId == executionId }) {
          toolEvents.append(ToolEvent(executionId: executionId, tool: tool ?? "tool", projectName: nil, status: "running"))
          reloadTimeline()
          if isNearBottom() { scrollToBottom(animated: true) }
        }
      case "awaiting_approval":
        setAgentStatus("Waiting for approval…")
        updateToolEvent(executionId: executionId) { $0.status = "awaiting_approval" }
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
    reloadTimeline()
  }

  // MARK: - Layout

  private func setupAgentStatusBar() {
    agentStatusBar.backgroundColor = .secondarySystemBackground
    agentStatusBar.clipsToBounds = true

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
    tableView.register(ToolGroupCell.self, forCellReuseIdentifier: ToolGroupCell.reuseID)
    tableView.register(SessionEventCell.self, forCellReuseIdentifier: SessionEventCell.reuseID)
    tableView.register(PlanPreviewCell.self, forCellReuseIdentifier: PlanPreviewCell.reuseID)
    tableView.register(ArtifactPreviewCell.self, forCellReuseIdentifier: ArtifactPreviewCell.reuseID)
    tableView.dataSource = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 80
    tableView.keyboardDismissMode = .interactive
    tableView.allowsSelection = false
    tableView.contentInset = UIEdgeInsets(top: 16, left: 0, bottom: 12, right: 0)
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
    composeBar.layer.shadowOpacity = 0.06
    composeBar.layer.shadowRadius = 3
    composeBar.layer.shadowOffset = CGSize(width: 0, height: 1)

    textView.placeholder = "Message..."

    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .medium
    sendButton.configuration?.image = UIImage(systemName: "arrow.up")
    sendButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8)
    sendButton.configurationUpdateHandler = { [weak self] btn in
      let hasContent = !(self?.textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
                    || !(self?.pendingAttachments.isEmpty ?? true)
      var cfg = btn.configuration
      cfg?.baseBackgroundColor = hasContent ? AppPalette.accent : AppPalette.muted
      cfg?.baseForegroundColor = hasContent ? AppPalette.accentForeground : AppPalette.foregroundSoft
      btn.configuration = cfg
    }
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
    view.bringSubviewToFront(agentStatusBar)
    view.bringSubviewToFront(composeBar)
  }

  private func observeKeyboard() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(keyboardChanged(_:)),
      name: UIResponder.keyboardWillChangeFrameNotification, object: nil
    )
    NotificationCenter.default.addObserver(forName: UITextView.textDidChangeNotification, object: textView, queue: .main) { [weak self] _ in
      self?.sendButton.setNeedsUpdateConfiguration()
    }
  }

  private func observeForeground() {
    NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      Task { await self?.refreshRecoveryState() }
    }
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
        async let loadedMessages = client.messages(sessionId: activeSessionId)
        async let loadedEvents = client.sessionEvents(sessionId: activeSessionId)
        let loaded = try await loadedMessages
        messages = loaded
        if let eventsResult = try? await loadedEvents {
          sessionEvents = eventsResult.events
        }
        rebuildToolEventsFromMessages()
        isLoaded = true
        reloadTimeline()
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
      icon.tintColor = .secondaryLabel
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
  private func pollMessagesAndStatus() async {
    await refreshStatus()
    await pollMessages()
  }

  @MainActor
  private func pollMessages() async {
    do {
      let updated = try await client.messages(sessionId: activeSessionId)
      guard updated.count != messages.count || updated.last?.id != messages.last?.id || hasExecutionChanges(updated) else { return }
      let nearBottom = isNearBottom()
      applyMessages(updated, scrollAnimated: nearBottom)
    } catch {}
  }

  private func applyMessages(_ updated: [ChatMessage], scrollAnimated: Bool) {
    messages = updated
    rebuildToolEventsFromMessages()
    reloadTimeline()
    if scrollAnimated { scrollToBottom(animated: true) }
  }

  private func hasExecutionChanges(_ updated: [ChatMessage]) -> Bool {
    let oldSig = messages.flatMap { $0.executions ?? [] }.map { "\($0.executionId):\($0.status):\($0.outputLog.count):\($0.result ?? "")" }
    let newSig = updated.flatMap { $0.executions ?? [] }.map { "\($0.executionId):\($0.status):\($0.outputLog.count):\($0.result ?? "")" }
    return oldSig != newSig
  }

  private func rebuildToolEventsFromMessages() {
    var next: [ToolEvent] = []
    var seen = Set<String>()
    for message in messages {
      for execution in message.executions ?? [] {
        guard !seen.contains(execution.executionId) else { continue }
        seen.insert(execution.executionId)
        next.append(ToolEvent(
          executionId: execution.executionId,
          tool: execution.action ?? execution.tool,
          projectName: execution.projectName,
          status: execution.status,
          output: execution.outputLog,
          result: execution.result,
          createdAt: execution.createdAt,
          action: execution.action,
          payload: execution.payload
        ))
      }
    }
    let persisted = Set(next.map(\.executionId))
    let liveOnly = toolEvents.filter { !persisted.contains($0.executionId) }
    toolEvents = next + liveOnly
  }

  @MainActor
  private func refreshRecoveryState() async {
    await refreshStatus()
    await reloadMessages()
    await refreshEvents()
    await refreshWorktree()
  }

  @MainActor
  private func refreshEvents() async {
    guard !activeSessionId.isEmpty else { return }
    do {
      let result = try await client.sessionEvents(sessionId: activeSessionId)
      sessionEvents = result.events
      reloadTimeline()
    } catch {}
  }

  @MainActor
  private func refreshStatus() async {
    guard !activeSessionId.isEmpty else { return }
    do {
      let status = try await client.chatStatus(sessionId: activeSessionId)
      if let execution = status.execution {
        switch execution.status {
        case "awaiting_approval":
          setAgentStatus("Waiting for approval...")
        case "running":
          setAgentStatus("\(formatToolName(execution.tool))...")
        default:
          setAgentStatus(status.active ? "Working..." : nil)
        }
        if !toolEvents.contains(where: { $0.executionId == execution.id }) {
          toolEvents.append(ToolEvent(executionId: execution.id, tool: execution.tool, projectName: nil, status: execution.status, createdAt: execution.createdAt))
          reloadTimeline()
        }
      } else if status.active {
        setAgentStatus("Working...")
      } else {
        setAgentStatus(nil)
      }
    } catch {}
  }

  private func isNearBottom() -> Bool {
    let bottom = tableView.contentSize.height - tableView.frame.height
    return tableView.contentOffset.y >= bottom - 80
  }

  private func reloadTimeline() {
    renderItems = buildRenderItems()
    tableView.reloadData()
  }

  private func buildRenderItems() -> [ChatRenderItem] {
    struct Entry {
      let time: Int
      let order: Int
      let item: ChatRenderItem
    }
    var entries: [Entry] = []
    var order = 0
    for message in messages {
      entries.append(Entry(time: message.createdAt ?? order, order: order, item: .message(message)))
      order += 1
    }
    for event in sessionEvents {
      if event.type == "plan_created", event.planId != nil, event.projectId != nil {
        entries.append(Entry(time: event.createdAt, order: order, item: .plan(event)))
      } else if let summary = artifactSummary(from: event) {
        entries.append(Entry(time: event.createdAt, order: order, item: .artifact(summary)))
      } else {
        entries.append(Entry(time: event.createdAt, order: order, item: .event(event)))
      }
      order += 1
    }
    for event in toolEvents where !isHiddenExecutionCard(event) {
      if let summary = artifactSummary(from: event) {
        entries.append(Entry(time: event.createdAt, order: order, item: .artifact(summary)))
      } else {
        entries.append(Entry(time: event.createdAt, order: order, item: .tool(event)))
      }
      order += 1
    }
    let sorted = entries.sorted {
      if $0.time == $1.time { return $0.order < $1.order }
      return $0.time < $1.time
    }.map(\.item)
    return groupRoutineTools(sorted)
  }

  private func groupRoutineTools(_ items: [ChatRenderItem]) -> [ChatRenderItem] {
    var result: [ChatRenderItem] = []
    var buffer: [ToolEvent] = []
    func flush() {
      guard !buffer.isEmpty else { return }
      if buffer.count >= 2 {
        result.append(.toolGroup(buffer))
      } else if let first = buffer.first {
        result.append(.tool(first))
      }
      buffer.removeAll()
    }
    for item in items {
      if case .tool(let event) = item, !isGroupExempt(event) {
        buffer.append(event)
      } else {
        flush()
        result.append(item)
      }
    }
    flush()
    return result
  }

  private func isGroupExempt(_ event: ToolEvent) -> Bool {
    let delegates = ["invoke_claude_code", "invoke_codex", "delegate_to_agent"]
    if delegates.contains(event.tool) { return true }
    if event.status == "error" || event.status == "awaiting_approval" { return true }
    return false
  }

  private func isHiddenExecutionCard(_ event: ToolEvent) -> Bool {
    if event.tool == "create_plan" { return true }
    return artifactSummary(from: event) != nil
  }

  private func artifactSummary(from event: SessionEvent) -> ArtifactSummary? {
    guard event.type == "artifact_created", let artifactId = event.artifactId, let projectId = event.projectId else { return nil }
    if let artifact = artifactCache[artifactId] {
      return artifactSummary(from: artifact)
    }
    Task { await fetchArtifact(projectId: projectId, artifactId: artifactId) }
    return ArtifactSummary(
      id: artifactId,
      projectId: projectId,
      title: event.title,
      subtitle: event.body ?? "Artifact",
      status: "ready",
      contentURL: nil,
      pathOrURL: nil
    )
  }

  private func artifactSummary(from event: ToolEvent) -> ArtifactSummary? {
    guard (event.tool == "create_artifact" || event.tool == "register_artifact"),
          event.status == "done",
          let result = event.result?.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: result) as? [String: Any],
          let artifactId = json["artifact_id"] as? String,
          let projectId = json["project_id"] as? String
    else { return nil }
    if let artifact = artifactCache[artifactId] {
      return artifactSummary(from: artifact)
    }
    Task { await fetchArtifact(projectId: projectId, artifactId: artifactId) }
    let title = (json["title"] as? String) ?? "Artifact"
    let kind = (json["kind"] as? String) ?? "Artifact"
    return ArtifactSummary(
      id: artifactId,
      projectId: projectId,
      title: title,
      subtitle: kind.capitalized,
      status: "ready",
      contentURL: json["content_url"] as? String,
      pathOrURL: (json["path"] as? String) ?? (json["url"] as? String)
    )
  }

  private func artifactSummary(from artifact: ProjectArtifact) -> ArtifactSummary {
    ArtifactSummary(
      id: artifact.id,
      projectId: artifact.projectId,
      title: artifact.title,
      subtitle: artifact.mimeType,
      status: artifact.status,
      contentURL: artifact.contentUrl,
      pathOrURL: artifact.path ?? artifact.url
    )
  }

  @MainActor
  private func fetchArtifact(projectId: String, artifactId: String) async {
    guard artifactCache[artifactId] == nil else { return }
    guard let artifact = try? await client.projectArtifacts(projectId: projectId).first(where: { $0.id == artifactId }) else { return }
    artifactCache[artifactId] = artifact
    reloadTimeline()
  }

  @MainActor
  private func loadPlan(planId: String, cacheKey: String) async {
    guard planCache[cacheKey] == nil else { return }
    guard let detail = try? await client.plan(planId: planId) else { return }
    planCache[cacheKey] = detail
    reloadTimeline()
  }

  private func openArtifact(_ summary: ArtifactSummary) {
    let artifact = artifactCache[summary.id] ?? ProjectArtifact(
      id: summary.id,
      projectId: summary.projectId,
      kind: "artifact",
      title: summary.title,
      description: nil,
      status: summary.status,
      mimeType: summary.subtitle,
      path: summary.pathOrURL,
      url: nil,
      contentUrl: summary.contentURL,
      sourcePlanId: nil,
      sourceStepId: nil,
      createdAt: Int(Date().timeIntervalSince1970)
    )
    let vc = ArtifactContentViewController(artifact: artifact, client: client)
    navigationController?.pushViewController(vc, animated: true)
  }

  private func scrollToBottom(animated: Bool) {
    let count = renderItems.count
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
    var children: [UIMenuElement] = [renameAction]
    if let worktree {
      let label = worktree.filesChanged > 0 ? "Worktree Diff (\(worktree.filesChanged))" : "Worktree Diff"
      let diffAction = UIAction(title: label, image: UIImage(systemName: "doc.text.magnifyingglass")) { [weak self] _ in
        self?.showWorktreeDiff()
      }
      let mergeAction = UIAction(title: "Merge \(worktree.branch)", image: UIImage(systemName: "arrow.triangle.merge"), attributes: worktree.ahead > 0 || worktree.filesChanged > 0 ? [] : .disabled) { [weak self] _ in
        self?.confirmMergeWorktree()
      }
      children.append(UIMenu(title: "Worktree", image: UIImage(systemName: "arrow.triangle.branch"), children: [diffAction, mergeAction]))
    }
    children.append(UIMenu(options: .displayInline, children: [deleteAction]))
    return UIMenu(children: children)
  }

  private func refreshOptionsMenu() {
    navigationItem.rightBarButtonItem?.menu = makeChatSettingsMenu()
    configPill.menu = makeConfigMenu()
    refreshConfigPill()
  }

  @MainActor
  private func refreshWorktree() async {
    guard !activeSessionId.isEmpty else { return }
    worktree = try? await client.sessionWorktree(sessionId: activeSessionId)
    refreshOptionsMenu()
  }

  private func showWorktreeDiff() {
    guard !activeSessionId.isEmpty else { return }
    Task {
      do {
        let result = try await client.worktreeDiff(sessionId: activeSessionId)
        let vc = DiffTextViewController(title: worktree?.branch ?? "Worktree Diff", diff: result.diff)
        navigationController?.pushViewController(vc, animated: true)
      } catch {
        showError(error)
      }
    }
  }

  private func confirmMergeWorktree() {
    let branch = worktree?.branch ?? "branch"
    let alert = UIAlertController(title: "Merge \(branch)?", message: "This merges the agent branch into the project repository.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Merge", style: .default) { [weak self] _ in
      guard let self else { return }
      Task {
        do {
          try await self.client.mergeSessionBranch(sessionId: self.activeSessionId)
          await self.refreshWorktree()
        } catch {
          self.showError(error)
        }
      }
    })
    present(alert, animated: true)
  }

  private static func shortModelName(_ id: String) -> String {
    // claude-sonnet-4-6 → "Sonnet 4.6", claude-opus-4-8 → "Opus 4.8", etc.
    let parts = id.lowercased().replacingOccurrences(of: "claude-", with: "").split(separator: "-")
    guard let family = parts.first else { return id }
    let version = parts.dropFirst().joined(separator: ".")
    return "\(family.capitalized) \(version)"
  }

  private func refreshConfigPill() {
    let modelLabel = currentModel.flatMap { modelDisplayNames[$0] ?? Self.shortModelName($0) } ?? "Auto"
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
      await refreshEvents()
      await refreshWorktree()
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

    let optimistic = ChatMessage(id: UUID().uuidString, role: "user", content: text, createdAt: nil, attachments: nil, executions: nil)
    messages.append(optimistic)
    reloadTimeline()
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
          reloadTimeline()
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
    sendButton.setNeedsUpdateConfiguration()
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
    renderItems.count
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    switch renderItems[indexPath.row] {
    case .message(let message):
      let cell = tableView.dequeueReusableCell(withIdentifier: MessageCell.reuseID, for: indexPath) as! MessageCell
      cell.configure(with: message)
      cell.onLongPress = { [weak self] text in self?.showMessageActions(text) }
      return cell
    case .tool(let event):
      let cell = tableView.dequeueReusableCell(withIdentifier: ToolEventCell.reuseID, for: indexPath) as! ToolEventCell
      cell.configure(with: event, expanded: expandedToolIds.contains(event.executionId))
      cell.onToggle = { [weak self] in
        guard let self else { return }
        if self.expandedToolIds.contains(event.executionId) {
          self.expandedToolIds.remove(event.executionId)
        } else {
          self.expandedToolIds.insert(event.executionId)
        }
        self.reloadTimeline()
      }
      cell.onApprove = { [weak self] in
        Task { try? await self?.client.approveExecution(id: event.executionId) }
      }
      cell.onDeny = { [weak self] in
        Task { try? await self?.client.rejectExecution(id: event.executionId) }
      }
      cell.onCancel = { [weak self] in
        Task {
          try? await self?.client.cancelExecution(id: event.executionId)
          await self?.reloadMessages()
        }
      }
      return cell
    case .toolGroup(let events):
      let cell = tableView.dequeueReusableCell(withIdentifier: ToolGroupCell.reuseID, for: indexPath) as! ToolGroupCell
      cell.configure(with: events)
      return cell
    case .event(let event):
      let cell = tableView.dequeueReusableCell(withIdentifier: SessionEventCell.reuseID, for: indexPath) as! SessionEventCell
      cell.configure(with: event)
      return cell
    case .plan(let event):
      let cell = tableView.dequeueReusableCell(withIdentifier: PlanPreviewCell.reuseID, for: indexPath) as! PlanPreviewCell
      let key = [event.projectId, event.planId].compactMap { $0 }.joined(separator: ":")
      cell.configure(event: event, detail: planCache[key])
      if event.projectId != nil, let planId = event.planId, planCache[key] == nil {
        Task { await loadPlan(planId: planId, cacheKey: key) }
      }
      return cell
    case .artifact(let summary):
      let cell = tableView.dequeueReusableCell(withIdentifier: ArtifactPreviewCell.reuseID, for: indexPath) as! ArtifactPreviewCell
      cell.configure(with: summary)
      cell.onOpen = { [weak self] in self?.openArtifact(summary) }
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

    bubbleMaxWidth = bubbleStack.widthAnchor.constraint(lessThanOrEqualTo: contentView.widthAnchor, multiplier: 0.78)
    NSLayoutConstraint.activate([
      bubbleStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5),
      bubbleStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -5),
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
      case .text(let str):
        for block in splitTextAndTables(str) {
          switch block {
          case .text(let text):
            contentStack.addArrangedSubview(makeTextSegment(text, font: baseFont, textColor: textColor, codeBg: codeBg, hInset: isUser ? 14 : 0, vInset: isUser ? 10 : 6, lineSpacing: isUser ? 0 : 4))
          case .table(let rows):
            contentStack.addArrangedSubview(makeTableSegment(rows: rows, isUser: isUser))
          }
        }
      case .code(let code): contentStack.addArrangedSubview(makeCodeSegment(code))
      }
    }
    if let attachments = message.attachments, !attachments.isEmpty {
      contentStack.addArrangedSubview(makeAttachmentHistoryView(attachments, isUser: isUser))
    }

    timeLabel.isHidden = true

    // Width: user bubble is capped (right-aligned via leading-inactive + trailing + width cap);
    // assistant spans full width (leading + trailing both active, no width cap) so the label wraps
    // against the screen margins instead of reporting an unwrapped intrinsic width.
    bubbleMaxWidth.isActive = isUser
    stackTrailing.isActive = true
    stackLeading.isActive = !isUser
  }

  private func makeTextSegment(_ text: String, font: UIFont, textColor: UIColor, codeBg: UIColor, hInset: CGFloat = 14, vInset: CGFloat = 10, lineSpacing: CGFloat = 0) -> UIView {
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
      label.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: vInset),
      label.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -vInset),
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

  private enum RichTextBlock {
    case text(String)
    case table([[String]])
  }

  private func splitTextAndTables(_ text: String) -> [RichTextBlock] {
    let lines = text.components(separatedBy: "\n")
    var blocks: [RichTextBlock] = []
    var textLines: [String] = []
    var i = 0

    func flushText() {
      let joined = textLines.joined(separator: "\n").trimmingCharacters(in: .newlines)
      if !joined.isEmpty { blocks.append(.text(joined)) }
      textLines.removeAll()
    }

    while i < lines.count {
      if i + 1 < lines.count, isMarkdownTableSeparator(lines[i + 1]), looksLikeTableRow(lines[i]) {
        flushText()
        var tableRows: [[String]] = [parseTableRow(lines[i])]
        i += 2
        while i < lines.count, looksLikeTableRow(lines[i]) {
          tableRows.append(parseTableRow(lines[i]))
          i += 1
        }
        if tableRows.count > 1 {
          blocks.append(.table(tableRows))
        }
      } else {
        textLines.append(lines[i])
        i += 1
      }
    }
    flushText()
    return blocks
  }

  private func looksLikeTableRow(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    return trimmed.contains("|") && parseTableRow(trimmed).count >= 2
  }

  private func isMarkdownTableSeparator(_ line: String) -> Bool {
    let cells = parseTableRow(line)
    guard cells.count >= 2 else { return false }
    return cells.allSatisfy { cell in
      let trimmed = cell.trimmingCharacters(in: .whitespaces)
      guard trimmed.count >= 3 else { return false }
      return trimmed.allSatisfy { $0 == "-" || $0 == ":" }
    }
  }

  private func parseTableRow(_ line: String) -> [String] {
    var trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.hasPrefix("|") { trimmed.removeFirst() }
    if trimmed.hasSuffix("|") { trimmed.removeLast() }
    return trimmed.split(separator: "|", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
  }

  private func makeTableSegment(rows: [[String]], isUser: Bool) -> UIView {
    let scrollView = UIScrollView()
    scrollView.showsHorizontalScrollIndicator = true
    scrollView.alwaysBounceHorizontal = false

    let tableStack = UIStackView()
    tableStack.axis = .vertical
    tableStack.spacing = 0
    tableStack.backgroundColor = AppPalette.borderSoft
    tableStack.layer.cornerRadius = 10
    tableStack.layer.cornerCurve = .continuous
    tableStack.layer.borderWidth = 1
    tableStack.layer.borderColor = AppPalette.borderSoft.cgColor
    tableStack.clipsToBounds = true

    let columnCount = rows.map(\.count).max() ?? 0
    for (rowIndex, row) in rows.enumerated() {
      let rowStack = UIStackView()
      rowStack.axis = .horizontal
      rowStack.spacing = 1
      rowStack.distribution = .fillEqually
      for columnIndex in 0..<columnCount {
        let label = UILabel()
        label.numberOfLines = 0
        label.font = rowIndex == 0 ? UIFont.app(forTextStyle: .caption1, weight: .semibold) : UIFont.app(forTextStyle: .caption1)
        label.textColor = rowIndex == 0 ? .label : AppPalette.foregroundSoft
        label.attributedText = applyInlineMarkdown(columnIndex < row.count ? row[columnIndex] : "", font: label.font, color: label.textColor, codeBg: AppPalette.muted)
        label.backgroundColor = rowIndex == 0 ? AppPalette.muted : AppPalette.card
        label.lineBreakMode = .byWordWrapping

        let cell = UIView()
        cell.backgroundColor = label.backgroundColor
        cell.addSubview(label)
        label.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
          cell.widthAnchor.constraint(greaterThanOrEqualToConstant: 112),
          label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 10),
          label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -10),
          label.topAnchor.constraint(equalTo: cell.topAnchor, constant: 8),
          label.bottomAnchor.constraint(equalTo: cell.bottomAnchor, constant: -8),
        ])
        rowStack.addArrangedSubview(cell)
      }
      tableStack.addArrangedSubview(rowStack)
      if rowIndex < rows.count - 1 {
        let divider = UIView()
        divider.backgroundColor = AppPalette.borderSoft
        NSLayoutConstraint.activate([divider.heightAnchor.constraint(equalToConstant: 1)])
        tableStack.addArrangedSubview(divider)
      }
    }

    scrollView.addSubview(tableStack)
    tableStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
      tableStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
      tableStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
      tableStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      tableStack.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor),
      tableStack.widthAnchor.constraint(greaterThanOrEqualTo: scrollView.frameLayoutGuide.widthAnchor),
    ])

    let wrapper = UIView()
    wrapper.addSubview(scrollView)
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: isUser ? 12 : 0),
      scrollView.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: isUser ? -12 : 0),
      scrollView.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 6),
      scrollView.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: -8),
    ])
    return wrapper
  }

  private func makeAttachmentHistoryView(_ attachments: [MessageAttachment], isUser: Bool) -> UIView {
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 6
    for attachment in attachments {
      let row = UIStackView()
      row.axis = .horizontal
      row.alignment = .center
      row.spacing = 6
      row.isLayoutMarginsRelativeArrangement = true
      row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 5, leading: 9, bottom: 5, trailing: 10)
      row.backgroundColor = isUser ? UIColor.systemBackground.withAlphaComponent(0.7) : AppPalette.muted
      row.layer.cornerRadius = 8
      row.layer.cornerCurve = .continuous

      let icon = UIImageView(image: UIImage(systemName: "paperclip"))
      icon.tintColor = .secondaryLabel
      icon.contentMode = .scaleAspectFit
      NSLayoutConstraint.activate([
        icon.widthAnchor.constraint(equalToConstant: 12),
        icon.heightAnchor.constraint(equalToConstant: 12),
      ])
      let label = UILabel()
      label.font = UIFont.app(forTextStyle: .caption1)
      label.textColor = .secondaryLabel
      label.lineBreakMode = .byTruncatingMiddle
      label.text = "\(attachment.filename) · \(byteCount(attachment.sizeBytes))"
      row.addArrangedSubview(icon)
      row.addArrangedSubview(label)
      stack.addArrangedSubview(row)
    }

    let wrapper = UIView()
    wrapper.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: isUser ? 12 : 0),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: wrapper.trailingAnchor, constant: isUser ? -12 : 0),
      stack.topAnchor.constraint(equalTo: wrapper.topAnchor, constant: 0),
      stack.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor, constant: isUser ? -10 : -4),
    ])
    return wrapper
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

  var onApprove: (() -> Void)?
  var onDeny: (() -> Void)?
  var onCancel: (() -> Void)?
  var onToggle: (() -> Void)?

  private let card = UIView()
  private let badge = UIView()
  private let iconView = UIImageView()
  private let nameLabel = UILabel()
  private let hintLabel = UILabel()
  private let pill = UIView()
  private let pillIcon = UIImageView()
  private let pillLabel = UILabel()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let approveBtn = UIButton(type: .system)
  private let denyBtn = UIButton(type: .system)
  private let cancelBtn = UIButton(type: .system)
  private let approvalRow = UIStackView()
  private let outputLabel = UILabel()
  private let detailStack = UIStackView()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    buildLayout()
    let tap = UITapGestureRecognizer(target: self, action: #selector(toggleTapped))
    card.addGestureRecognizer(tap)
  }

  required init?(coder: NSCoder) { fatalError() }

  private func buildLayout() {
    card.backgroundColor = AppPalette.card
    card.layer.cornerRadius = 10
    card.layer.cornerCurve = .continuous
    card.layer.borderWidth = 1
    card.layer.borderColor = AppPalette.borderSoft.cgColor

    badge.backgroundColor = AppPalette.accent.withAlphaComponent(0.12)
    badge.layer.cornerRadius = 6
    badge.layer.cornerCurve = .continuous
    badge.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      badge.widthAnchor.constraint(equalToConstant: 24),
      badge.heightAnchor.constraint(equalToConstant: 24),
    ])

    iconView.contentMode = .scaleAspectFit
    badge.addSubview(iconView)
    iconView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      iconView.centerXAnchor.constraint(equalTo: badge.centerXAnchor),
      iconView.centerYAnchor.constraint(equalTo: badge.centerYAnchor),
      iconView.widthAnchor.constraint(equalToConstant: 12),
      iconView.heightAnchor.constraint(equalToConstant: 12),
    ])

    nameLabel.font = UIFont.app(forTextStyle: .footnote).withWeight(.medium)
    nameLabel.textColor = .label

    hintLabel.font = UIFont.monospacedSystemFont(ofSize: 10, weight: .regular)
    hintLabel.textColor = .secondaryLabel
    hintLabel.numberOfLines = 1
    hintLabel.isHidden = true

    let nameStack = UIStackView(arrangedSubviews: [nameLabel, hintLabel])
    nameStack.axis = .vertical
    nameStack.spacing = 2

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

    let headerRow = UIStackView(arrangedSubviews: [badge, nameStack, UIView(), pill])
    headerRow.axis = .horizontal
    headerRow.alignment = .center
    headerRow.spacing = 9

    approveBtn.configuration = .filled()
    approveBtn.configuration?.cornerStyle = .capsule
    approveBtn.configuration?.baseBackgroundColor = AppPalette.accent
    approveBtn.configuration?.baseForegroundColor = AppPalette.accentForeground
    approveBtn.configuration?.image = UIImage(systemName: "checkmark")
    approveBtn.configuration?.title = "Approve"
    approveBtn.configuration?.imagePadding = 5
    approveBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    approveBtn.addTarget(self, action: #selector(approveTapped), for: .touchUpInside)

    denyBtn.configuration = .borderedTinted()
    denyBtn.configuration?.cornerStyle = .capsule
    denyBtn.configuration?.baseForegroundColor = .secondaryLabel
    denyBtn.configuration?.title = "Deny"
    denyBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    denyBtn.addTarget(self, action: #selector(denyTapped), for: .touchUpInside)

    cancelBtn.configuration = .borderedTinted()
    cancelBtn.configuration?.cornerStyle = .capsule
    cancelBtn.configuration?.baseForegroundColor = AppPalette.destructive
    cancelBtn.configuration?.image = UIImage(systemName: "xmark")
    cancelBtn.configuration?.title = "Cancel"
    cancelBtn.configuration?.imagePadding = 5
    cancelBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 12, bottom: 7, trailing: 12)
    cancelBtn.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

    approvalRow.axis = .horizontal
    approvalRow.spacing = 8
    approvalRow.addArrangedSubview(approveBtn)
    approvalRow.addArrangedSubview(denyBtn)
    approvalRow.addArrangedSubview(UIView())
    approvalRow.isHidden = true

    outputLabel.numberOfLines = 0
    outputLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    outputLabel.textColor = AppPalette.foregroundSoft
    outputLabel.backgroundColor = AppPalette.codeBackground
    outputLabel.layer.cornerRadius = 8
    outputLabel.layer.cornerCurve = .continuous
    outputLabel.clipsToBounds = true

    detailStack.axis = .vertical
    detailStack.spacing = 8
    detailStack.addArrangedSubview(outputLabel)
    detailStack.addArrangedSubview(cancelBtn)
    detailStack.isHidden = true

    let stack = UIStackView(arrangedSubviews: [headerRow, approvalRow, detailStack])
    stack.axis = .vertical
    stack.spacing = 10
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10)

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
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
  }

  private static func toolIcon(for tool: String) -> String {
    let t = tool.lowercased()
    if t.contains("github") { return "arrow.triangle.pull" }
    if t.contains("git") { return "arrow.triangle.branch" }
    if t.contains("file") || t.contains("read") || t.contains("write") { return "doc.text" }
    if t.contains("claude") || t.contains("mcp") || t.contains("agent") { return "seal" }
    if t.contains("code") || t.contains("project") { return "chevron.left.forwardslash.chevron.right" }
    return "terminal"
  }

  private static func toolName(_ raw: String) -> String {
    let stripped = raw.hasPrefix("invoke_") ? String(raw.dropFirst(7)) : raw
    return stripped.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
  }

  private static func hint(from event: ToolEvent) -> String? {
    if let payloadHint = event.payload?.summary, !payloadHint.isEmpty { return payloadHint }
    if let project = event.projectName { return project }
    let output = event.output.isEmpty ? (event.result ?? "") : event.output
    return output.split(separator: "\n")
      .map { $0.trimmingCharacters(in: .whitespaces) }
      .first { $0.count > 3 && $0.count < 80 }
  }

  func configure(with event: ToolEvent, expanded: Bool) {
    nameLabel.text = Self.toolName(event.tool)
    iconView.image = UIImage(systemName: Self.toolIcon(for: event.tool))
    iconView.tintColor = AppPalette.accent

    let output = event.output.trimmingCharacters(in: .whitespacesAndNewlines)
    let text = output.isEmpty ? (event.result?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") : output
    if let h = Self.hint(from: event) {
      hintLabel.text = h
      hintLabel.isHidden = false
    } else {
      hintLabel.isHidden = true
    }
    outputLabel.attributedText = diffAwareAttributedText(text.isEmpty ? "No output yet." : text)
    detailStack.isHidden = !expanded
    cancelBtn.isHidden = event.status != "running"

    switch event.status {
    case "running":
      card.layer.borderColor = AppPalette.borderSoft.cgColor
      pill.backgroundColor = AppPalette.accent.withAlphaComponent(0.14)
      pillLabel.textColor = AppPalette.accent
      pillLabel.text = "Running"
      pillIcon.isHidden = true
      spinner.isHidden = false
      spinner.color = AppPalette.accent
      spinner.startAnimating()
      approvalRow.isHidden = true
    case "awaiting_approval":
      card.layer.borderColor = AppPalette.warning.withAlphaComponent(0.4).cgColor
      pill.backgroundColor = AppPalette.warning.withAlphaComponent(0.14)
      pillLabel.textColor = AppPalette.warning
      pillLabel.text = "Approval"
      pillIcon.image = UIImage(systemName: "clock")
      pillIcon.tintColor = AppPalette.warning
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
      approvalRow.isHidden = false
    case "done":
      card.layer.borderColor = AppPalette.borderSoft.cgColor
      pill.backgroundColor = AppPalette.success.withAlphaComponent(0.14)
      pillLabel.textColor = AppPalette.success
      pillLabel.text = "Done"
      pillIcon.image = UIImage(systemName: "checkmark")
      pillIcon.tintColor = AppPalette.success
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
      approvalRow.isHidden = true
    case "error":
      card.layer.borderColor = AppPalette.borderSoft.cgColor
      pill.backgroundColor = AppPalette.destructive.withAlphaComponent(0.12)
      pillLabel.textColor = AppPalette.destructive
      pillLabel.text = "Error"
      pillIcon.image = UIImage(systemName: "exclamationmark.circle")
      pillIcon.tintColor = AppPalette.destructive
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
      approvalRow.isHidden = true
    default:
      card.layer.borderColor = AppPalette.borderSoft.cgColor
      pill.backgroundColor = AppPalette.muted
      pillLabel.textColor = .secondaryLabel
      pillLabel.text = "Pending"
      pillIcon.image = UIImage(systemName: "circle.fill")
      pillIcon.tintColor = .secondaryLabel
      pillIcon.isHidden = false
      spinner.isHidden = true
      spinner.stopAnimating()
      approvalRow.isHidden = true
    }
  }

  @objc private func approveTapped() { onApprove?() }
  @objc private func denyTapped() { onDeny?() }
  @objc private func cancelTapped() { onCancel?() }
  @objc private func toggleTapped() { onToggle?() }
}

// MARK: - Supporting timeline cells

private final class ToolGroupCell: UITableViewCell {
  static let reuseID = "ToolGroupCell"
  private let pillContainer = UIView()
  private let iconView = UIImageView()
  private let label = UILabel()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none

    pillContainer.backgroundColor = AppPalette.muted
    pillContainer.layer.cornerRadius = 10
    pillContainer.layer.cornerCurve = .continuous
    pillContainer.translatesAutoresizingMaskIntoConstraints = false

    iconView.image = UIImage(systemName: "chevron.right.2")
    iconView.tintColor = .secondaryLabel
    iconView.contentMode = .scaleAspectFit
    iconView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      iconView.widthAnchor.constraint(equalToConstant: 11),
      iconView.heightAnchor.constraint(equalToConstant: 11),
    ])

    label.font = UIFont.app(forTextStyle: .caption1)
    label.textColor = .secondaryLabel
    label.numberOfLines = 1

    let row = UIStackView(arrangedSubviews: [iconView, label])
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 5
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 5, leading: 10, bottom: 5, trailing: 10)
    row.translatesAutoresizingMaskIntoConstraints = false

    pillContainer.addSubview(row)
    contentView.addSubview(pillContainer)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: pillContainer.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: pillContainer.trailingAnchor),
      row.topAnchor.constraint(equalTo: pillContainer.topAnchor),
      row.bottomAnchor.constraint(equalTo: pillContainer.bottomAnchor),
      pillContainer.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      pillContainer.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 3),
      pillContainer.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -3),
    ])
  }

  required init?(coder: NSCoder) { fatalError() }

  func configure(with events: [ToolEvent]) {
    let names = events.prefix(3).map { event -> String in
      let stripped = event.tool.hasPrefix("invoke_") ? String(event.tool.dropFirst(7)) : event.tool
      return stripped.split(separator: "_").map { $0.capitalized }.joined(separator: " ")
    }
    let overflow = events.count > 3 ? " · +\(events.count - 3) more" : ""
    label.text = "Ran \(events.count) tools · \(names.joined(separator: " · "))\(overflow)"
  }
}

private final class SessionEventCell: UITableViewCell {
  static let reuseID = "SessionEventCell"
  private let card = UIView()
  private let icon = UIImageView()
  private let titleLabel = UILabel()
  private let bodyLabel = UILabel()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    card.backgroundColor = AppPalette.card
    card.layer.borderWidth = 1
    card.layer.borderColor = AppPalette.borderSoft.cgColor
    card.layer.cornerRadius = 10
    icon.contentMode = .scaleAspectFit
    icon.tintColor = .secondaryLabel
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 16),
      icon.heightAnchor.constraint(equalToConstant: 16),
    ])
    titleLabel.font = UIFont.app(forTextStyle: .footnote).withWeight(.medium)
    titleLabel.numberOfLines = 0
    bodyLabel.font = UIFont.app(forTextStyle: .caption1)
    bodyLabel.textColor = .secondaryLabel
    bodyLabel.numberOfLines = 0
    let textStack = UIStackView(arrangedSubviews: [titleLabel, bodyLabel])
    textStack.axis = .vertical
    textStack.spacing = 2
    let row = UIStackView(arrangedSubviews: [icon, textStack])
    row.axis = .horizontal
    row.alignment = .top
    row.spacing = 9
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    card.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      row.topAnchor.constraint(equalTo: card.topAnchor),
      row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
  }

  required init?(coder: NSCoder) { fatalError() }

  func configure(with event: SessionEvent) {
    titleLabel.text = event.title
    bodyLabel.text = event.body
    bodyLabel.isHidden = event.body?.isEmpty ?? true
    switch event.type {
    case "mcp_required":
      icon.image = UIImage(systemName: "gearshape")
      card.layer.borderColor = AppPalette.warning.withAlphaComponent(0.45).cgColor
    case "project_created", "project_linked":
      icon.image = UIImage(systemName: "folder")
      card.layer.borderColor = AppPalette.borderSoft.cgColor
    default:
      icon.image = UIImage(systemName: "sparkles")
      card.layer.borderColor = AppPalette.borderSoft.cgColor
    }
  }
}

private final class PlanPreviewCell: UITableViewCell {
  static let reuseID = "PlanPreviewCell"
  private let card = UIView()
  private let titleLabel = UILabel()
  private let statusLabel = UILabel()
  private let stepsLabel = UILabel()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    card.backgroundColor = AppPalette.card
    card.layer.borderWidth = 1
    card.layer.borderColor = AppPalette.accent.withAlphaComponent(0.28).cgColor
    card.layer.cornerRadius = 10
    titleLabel.font = UIFont.app(forTextStyle: .subheadline).withWeight(.semibold)
    titleLabel.numberOfLines = 0
    statusLabel.font = UIFont.app(forTextStyle: .caption1).withWeight(.medium)
    statusLabel.textColor = AppPalette.accent
    stepsLabel.font = UIFont.app(forTextStyle: .caption1)
    stepsLabel.textColor = .secondaryLabel
    stepsLabel.numberOfLines = 4
    let stack = UIStackView(arrangedSubviews: [titleLabel, statusLabel, stepsLabel])
    stack.axis = .vertical
    stack.spacing = 5
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 13, bottom: 12, trailing: 13)
    card.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      stack.topAnchor.constraint(equalTo: card.topAnchor),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -5),
    ])
  }

  required init?(coder: NSCoder) { fatalError() }

  func configure(event: SessionEvent, detail: PlanDetailResult?) {
    titleLabel.text = detail?.plan.title ?? event.title
    statusLabel.text = (detail?.plan.status ?? "plan").uppercased()
    let steps = detail?.steps.sorted { $0.position < $1.position }.prefix(3).map { step in
      "\(step.status == "done" ? "[x]" : "[ ]") \(step.title)"
    }
    stepsLabel.text = steps?.joined(separator: "\n") ?? (event.body ?? "Loading steps...")
  }
}

private final class ArtifactPreviewCell: UITableViewCell {
  static let reuseID = "ArtifactPreviewCell"
  var onOpen: (() -> Void)?
  private let card = UIView()
  private let titleLabel = UILabel()
  private let subtitleLabel = UILabel()
  private let statusLabel = UILabel()

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    card.backgroundColor = AppPalette.card
    card.layer.borderWidth = 1
    card.layer.borderColor = AppPalette.borderSoft.cgColor
    card.layer.cornerRadius = 10
    titleLabel.font = UIFont.app(forTextStyle: .subheadline).withWeight(.semibold)
    titleLabel.numberOfLines = 0
    subtitleLabel.font = UIFont.app(forTextStyle: .caption1)
    subtitleLabel.textColor = .secondaryLabel
    statusLabel.font = UIFont.app(forTextStyle: .caption2).withWeight(.medium)
    statusLabel.textColor = AppPalette.success
    let icon = UIImageView(image: UIImage(systemName: "doc.richtext"))
    icon.tintColor = AppPalette.accent
    icon.contentMode = .scaleAspectFit
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 22),
      icon.heightAnchor.constraint(equalToConstant: 22),
    ])
    let textStack = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel, statusLabel])
    textStack.axis = .vertical
    textStack.spacing = 3
    let row = UIStackView(arrangedSubviews: [icon, textStack])
    row.axis = .horizontal
    row.alignment = .top
    row.spacing = 10
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 13, bottom: 12, trailing: 13)
    card.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      row.topAnchor.constraint(equalTo: card.topAnchor),
      row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 5),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -5),
    ])
    card.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(openTapped)))
  }

  required init?(coder: NSCoder) { fatalError() }

  func configure(with summary: ArtifactSummary) {
    titleLabel.text = summary.title
    subtitleLabel.text = summary.subtitle
    statusLabel.text = summary.status.uppercased()
    statusLabel.textColor = summary.status == "error" ? AppPalette.destructive : AppPalette.success
  }

  @objc private func openTapped() { onOpen?() }
}

private final class DiffTextViewController: UIViewController {
  private let diffTitle: String
  private let diff: String

  init(title: String, diff: String) {
    self.diffTitle = title
    self.diff = diff
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = diffTitle
    view.backgroundColor = .systemBackground
    let textView = UITextView()
    textView.isEditable = false
    textView.backgroundColor = AppPalette.codeBackground
    textView.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
    textView.attributedText = diffAwareAttributedText(diff.isEmpty ? "No diff." : diff)
    view.addSubview(textView)
    textView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      textView.topAnchor.constraint(equalTo: view.topAnchor),
      textView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }
}

private func byteCount(_ bytes: Int) -> String {
  ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
}

private func looksLikeDiff(_ text: String) -> Bool {
  text.range(of: #"(?m)^@@\s+-\d"#, options: .regularExpression) != nil ||
  (text.contains("--- ") && text.contains("+++ "))
}

private func diffAwareAttributedText(_ text: String) -> NSAttributedString {
  let result = NSMutableAttributedString()
  let baseAttrs: [NSAttributedString.Key: Any] = [
    .font: UIFont.monospacedSystemFont(ofSize: 11, weight: .regular),
    .foregroundColor: AppPalette.codeForeground
  ]
  guard looksLikeDiff(text) else {
    return NSAttributedString(string: text, attributes: baseAttrs)
  }
  for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
    var attrs = baseAttrs
    if line.hasPrefix("+") && !line.hasPrefix("+++") {
      attrs[.foregroundColor] = AppPalette.success
    } else if line.hasPrefix("-") && !line.hasPrefix("---") {
      attrs[.foregroundColor] = AppPalette.destructive
    } else if line.hasPrefix("@@") {
      attrs[.foregroundColor] = AppPalette.accent
    }
    result.append(NSAttributedString(string: String(line) + "\n", attributes: attrs))
  }
  return result
}
