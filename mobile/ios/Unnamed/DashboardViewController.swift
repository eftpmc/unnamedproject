import UIKit

final class DashboardViewController: UIViewController {
  var onSignedOut: (() -> Void)?
  var onChangeServer: (() -> Void)?
  var onShowChats: (() -> Void)?
  var onShowChat: ((ChatSession) -> Void)?
  var onShowInbox: (() -> Void)?
  var onShowProjects: (() -> Void)?

  private let session: AppSession
  private lazy var client = APIClient(session: session)

  private var profile: UserProfile?
  private var chats: [ChatSession] = []
  private var projects: [Project] = []
  private var approvalCount = 0
  private var activeIds: Set<String> = []
  private let inboxBadge = UILabel()

  private let scrollView = UIScrollView()
  private let contentStack = UIStackView()
  private let promptTextView = ComposerTextView()
  private let sendButton = UIButton(type: .system)
  private let refreshControl = UIRefreshControl()
  private let activity = UIActivityIndicatorView(style: .medium)

  private let statusLabel = UILabel()
  private let recentStack = UIStackView()
  private let projectStack = UIStackView()

  init(session: AppSession) {
    self.session = session
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Unnamed"
    view.backgroundColor = AppTheme.canvas
    navigationController?.navigationBar.prefersLargeTitles = false
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Server", style: .plain, target: self, action: #selector(changeServerTapped))

    configureScrollView()
    configureHero()
    configureWorkCards()
    configureSections()
    load()
  }

  private func configureScrollView() {
    scrollView.alwaysBounceVertical = true
    scrollView.refreshControl = refreshControl
    refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)

    contentStack.axis = .vertical
    contentStack.spacing = 18
    contentStack.isLayoutMarginsRelativeArrangement = true
    contentStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 18, leading: 18, bottom: 32, trailing: 18)

    view.addSubview(scrollView)
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    scrollView.addSubview(contentStack)
    contentStack.translatesAutoresizingMaskIntoConstraints = false

    NSLayoutConstraint.activate([
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
      contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
      contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
      contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor)
    ])
  }

  private func configureHero() {
    let brandRow = UIStackView()
    brandRow.axis = .horizontal
    brandRow.alignment = .center
    brandRow.spacing = 10

    let mark = UILabel()
    mark.text = "u"
    mark.font = UIFont.preferredFont(forTextStyle: .headline)
    mark.textAlignment = .center
    mark.textColor = AppTheme.primaryText
    mark.backgroundColor = AppTheme.primary
    mark.layer.cornerRadius = 8
    mark.layer.cornerCurve = .continuous
    mark.clipsToBounds = true
    NSLayoutConstraint.activate([
      mark.widthAnchor.constraint(equalToConstant: 32),
      mark.heightAnchor.constraint(equalToConstant: 32)
    ])

    let brandLabel = UILabel()
    brandLabel.text = "unnamed"
    brandLabel.font = UIFont.preferredFont(forTextStyle: .headline)
    brandLabel.adjustsFontForContentSizeCategory = true

    statusLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
    statusLabel.adjustsFontForContentSizeCategory = true
    statusLabel.textColor = .secondaryLabel
    statusLabel.textAlignment = .right

    brandRow.addArrangedSubview(mark)
    brandRow.addArrangedSubview(brandLabel)
    brandRow.addArrangedSubview(UIView())
    brandRow.addArrangedSubview(statusLabel)

    let titleLabel = UILabel()
    titleLabel.text = "What should keep moving?"
    titleLabel.font = UIFont.preferredFont(forTextStyle: .largeTitle)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.numberOfLines = 0

    let subtitleLabel = UILabel()
    subtitleLabel.text = "Start a chat, steer active work, or jump back into a project from your phone."
    subtitleLabel.font = UIFont.preferredFont(forTextStyle: .body)
    subtitleLabel.adjustsFontForContentSizeCategory = true
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.numberOfLines = 0

    let composer = SurfaceView()
    let composerStack = UIStackView()
    composerStack.axis = .vertical
    composerStack.spacing = 10
    composerStack.isLayoutMarginsRelativeArrangement = true
    composerStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 12, trailing: 12)

    promptTextView.placeholder = "Message the agent..."
    promptTextView.returnKeyType = .default
    promptTextView.heightAnchor.constraint(greaterThanOrEqualToConstant: 56).isActive = true

    let composerToolbar = UIStackView()
    composerToolbar.axis = .horizontal
    composerToolbar.alignment = .center
    composerToolbar.spacing = 8

    let hint = UILabel()
    hint.text = "Creates a new chat"
    hint.font = UIFont.preferredFont(forTextStyle: .caption1)
    hint.adjustsFontForContentSizeCategory = true
    hint.textColor = .tertiaryLabel

    sendButton.configuration = .filled()
    sendButton.configuration?.cornerStyle = .medium
    sendButton.configuration?.baseBackgroundColor = AppTheme.primary
    sendButton.configuration?.baseForegroundColor = AppTheme.primaryText
    sendButton.configuration?.image = UIImage(systemName: "arrow.up")
    sendButton.configuration?.title = "Send"
    sendButton.configuration?.imagePadding = 6
    sendButton.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)

    composerToolbar.addArrangedSubview(hint)
    composerToolbar.addArrangedSubview(UIView())
    composerToolbar.addArrangedSubview(activity)
    composerToolbar.addArrangedSubview(sendButton)

    composerStack.addArrangedSubview(promptTextView)
    composerStack.addArrangedSubview(composerToolbar)
    composer.addSubview(composerStack)
    composerStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      composerStack.leadingAnchor.constraint(equalTo: composer.leadingAnchor),
      composerStack.trailingAnchor.constraint(equalTo: composer.trailingAnchor),
      composerStack.topAnchor.constraint(equalTo: composer.topAnchor),
      composerStack.bottomAnchor.constraint(equalTo: composer.bottomAnchor)
    ])

    contentStack.addArrangedSubview(brandRow)
    contentStack.addArrangedSubview(titleLabel)
    contentStack.setCustomSpacing(6, after: titleLabel)
    contentStack.addArrangedSubview(subtitleLabel)
    contentStack.addArrangedSubview(composer)
  }

  private func configureWorkCards() {
    let grid = UIStackView()
    grid.axis = .vertical
    grid.spacing = 10

    let inboxCard = actionCard(icon: "bell.badge", title: "Inbox", subtitle: "Approvals and agent requests", tint: AppTheme.warning, action: { [weak self] in self?.onShowInbox?() })

    // Badge pinned to icon's top-right corner (icon sits at leading:13 top:13, size:36)
    inboxBadge.font = .systemFont(ofSize: 11, weight: .bold)
    inboxBadge.textColor = .white
    inboxBadge.textAlignment = .center
    inboxBadge.backgroundColor = .systemRed
    inboxBadge.layer.cornerRadius = 8
    inboxBadge.clipsToBounds = true
    inboxBadge.isHidden = true
    inboxBadge.translatesAutoresizingMaskIntoConstraints = false
    inboxCard.addSubview(inboxBadge)
    NSLayoutConstraint.activate([
      inboxBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 20),
      inboxBadge.heightAnchor.constraint(equalToConstant: 16),
      inboxBadge.centerXAnchor.constraint(equalTo: inboxCard.leadingAnchor, constant: 49),
      inboxBadge.centerYAnchor.constraint(equalTo: inboxCard.topAnchor, constant: 13),
    ])

    grid.addArrangedSubview(inboxCard)
    grid.addArrangedSubview(actionCard(icon: "message", title: "Chats", subtitle: "Recent conversations", tint: AppTheme.accent, action: { [weak self] in self?.onShowChats?() }))
    grid.addArrangedSubview(actionCard(icon: "folder", title: "Projects", subtitle: "Repos and artifacts", tint: .systemGreen, action: { [weak self] in self?.onShowProjects?() }))

    contentStack.addArrangedSubview(grid)
  }

  private func configureSections() {
    recentStack.axis = .vertical
    recentStack.spacing = 8
    projectStack.axis = .vertical
    projectStack.spacing = 8

    contentStack.addArrangedSubview(section(title: "Recent", stack: recentStack))
    contentStack.addArrangedSubview(section(title: "Projects", stack: projectStack))
  }

  private func section(title: String, stack: UIStackView) -> UIView {
    let wrapper = UIStackView()
    wrapper.axis = .vertical
    wrapper.spacing = 10

    let label = UILabel()
    label.text = title
    label.font = UIFont.preferredFont(forTextStyle: .headline)
    label.adjustsFontForContentSizeCategory = true

    wrapper.addArrangedSubview(label)
    wrapper.addArrangedSubview(stack)
    return wrapper
  }

  private func actionCard(icon: String, title: String, subtitle: String, tint: UIColor, action: (() -> Void)? = nil) -> UIView {
    let card = SurfaceView()
    let row = UIStackView()
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 12
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 13, leading: 13, bottom: 13, trailing: 13)

    let textStack = UIStackView()
    textStack.axis = .vertical
    textStack.spacing = 2

    let titleLabel = UILabel()
    titleLabel.text = title
    titleLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    titleLabel.adjustsFontForContentSizeCategory = true

    let subtitleLabel = UILabel()
    subtitleLabel.text = subtitle
    subtitleLabel.font = UIFont.preferredFont(forTextStyle: .caption1)
    subtitleLabel.adjustsFontForContentSizeCategory = true
    subtitleLabel.textColor = .secondaryLabel

    textStack.addArrangedSubview(titleLabel)
    textStack.addArrangedSubview(subtitleLabel)

    let chevron = UIImageView(image: UIImage(systemName: "chevron.right"))
    chevron.tintColor = .tertiaryLabel

    row.addArrangedSubview(IconBadgeView(systemName: icon, tintColor: tint))
    row.addArrangedSubview(textStack)
    row.addArrangedSubview(chevron)
    card.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      row.topAnchor.constraint(equalTo: card.topAnchor),
      row.bottomAnchor.constraint(equalTo: card.bottomAnchor)
    ])

    if let action {
      let hit = UIControl()
      hit.addAction(UIAction { _ in action() }, for: .touchUpInside)
      hit.translatesAutoresizingMaskIntoConstraints = false
      card.addSubview(hit)
      NSLayoutConstraint.activate([
        hit.leadingAnchor.constraint(equalTo: card.leadingAnchor),
        hit.trailingAnchor.constraint(equalTo: card.trailingAnchor),
        hit.topAnchor.constraint(equalTo: card.topAnchor),
        hit.bottomAnchor.constraint(equalTo: card.bottomAnchor),
      ])
    }
    return card
  }

  private func listRow(icon: String, title: String, subtitle: String?, tint: UIColor, isActive: Bool = false) -> UIView {
    let row = UIStackView()
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 10
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 2, bottom: 10, trailing: 2)

    let textStack = UIStackView()
    textStack.axis = .vertical
    textStack.spacing = 2

    let titleLabel = UILabel()
    titleLabel.text = title
    titleLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.numberOfLines = 1

    let subtitleLabel = UILabel()
    subtitleLabel.text = subtitle
    subtitleLabel.font = UIFont.preferredFont(forTextStyle: .caption1)
    subtitleLabel.adjustsFontForContentSizeCategory = true
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.numberOfLines = 1

    textStack.addArrangedSubview(titleLabel)
    if subtitle != nil { textStack.addArrangedSubview(subtitleLabel) }

    row.addArrangedSubview(IconBadgeView(systemName: icon, tintColor: tint))
    row.addArrangedSubview(textStack)

    if isActive {
      let spacer = UIView()
      spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
      row.addArrangedSubview(spacer)

      let dot = UIView()
      dot.backgroundColor = .systemGreen
      dot.layer.cornerRadius = 4
      dot.translatesAutoresizingMaskIntoConstraints = false
      row.addArrangedSubview(dot)
      NSLayoutConstraint.activate([
        dot.widthAnchor.constraint(equalToConstant: 8),
        dot.heightAnchor.constraint(equalToConstant: 8),
      ])
      let anim = CABasicAnimation(keyPath: "opacity")
      anim.fromValue = 1.0; anim.toValue = 0.25; anim.duration = 0.9
      anim.autoreverses = true; anim.repeatCount = .infinity
      dot.layer.add(anim, forKey: "pulse")
    }

    return row
  }

  private func renderData() {
    statusLabel.text = profile?.email ?? "Connected"
    if approvalCount > 0 {
      inboxBadge.text = "\(min(approvalCount, 99))"
      inboxBadge.isHidden = false
    } else {
      inboxBadge.isHidden = true
    }
    renderRecent()
    renderProjects()
  }

  private func renderRecent() {
    recentStack.arrangedSubviews.forEach { view in
      recentStack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }

    if chats.isEmpty {
      recentStack.addArrangedSubview(emptyRow("No chats yet", "Send a prompt above to start one."))
      return
    }

    for chat in chats.prefix(5) {
      let isActive = activeIds.contains(chat.id)
      let timePart = (chat.updatedAt ?? chat.createdAt).map { relativeTime(from: $0) }
      let metaParts = [chat.model ?? chat.effort, timePart].compactMap { $0 }
      let subtitle = metaParts.isEmpty ? nil : metaParts.joined(separator: " · ")

      let row = listRow(
        icon: "message",
        title: chat.title ?? "Untitled chat",
        subtitle: subtitle,
        tint: isActive ? .systemGreen : AppTheme.accent,
        isActive: isActive
      )
      let hit = UIControl()
      hit.addAction(UIAction { [weak self] _ in self?.onShowChat?(chat) }, for: .touchUpInside)
      hit.translatesAutoresizingMaskIntoConstraints = false
      row.addSubview(hit)
      NSLayoutConstraint.activate([
        hit.leadingAnchor.constraint(equalTo: row.leadingAnchor),
        hit.trailingAnchor.constraint(equalTo: row.trailingAnchor),
        hit.topAnchor.constraint(equalTo: row.topAnchor),
        hit.bottomAnchor.constraint(equalTo: row.bottomAnchor),
      ])
      recentStack.addArrangedSubview(row)
    }
  }

  private func renderProjects() {
    projectStack.arrangedSubviews.forEach { view in
      projectStack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }

    if projects.isEmpty {
      projectStack.addArrangedSubview(emptyRow("No projects yet", "Projects from the server will appear here."))
      return
    }

    for project in projects.prefix(5) {
      projectStack.addArrangedSubview(listRow(
        icon: "folder",
        title: project.name,
        subtitle: project.repoPath ?? project.description,
        tint: .systemGreen
      ))
    }
  }

  private func emptyRow(_ title: String, _ subtitle: String) -> UIView {
    let label = UILabel()
    label.text = "\(title)\n\(subtitle)"
    label.font = UIFont.preferredFont(forTextStyle: .subheadline)
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .secondaryLabel
    label.numberOfLines = 0
    return label
  }

  @objc private func refreshPulled() {
    load()
  }

  @objc private func changeServerTapped() {
    onChangeServer?()
  }

  @objc private func sendTapped() {
    let prompt = promptTextView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !prompt.isEmpty else { return }

    setSending(true)
    Task {
      do {
        let created = try await client.createSession(title: String(prompt.prefix(80)))
        _ = try await client.sendMessage(sessionId: created.id, content: prompt)
        promptTextView.text = ""
        // Navigate into the new chat so the user can see its messages
        let chatSession = ChatSession(id: created.id, title: String(prompt.prefix(80)), effort: nil, model: nil, pinnedProjectId: nil, createdAt: nil, updatedAt: nil)
        onShowChat?(chatSession)
        load()
      } catch APIError.unauthorized {
        onSignedOut?()
      } catch {
        showError(error)
      }
      setSending(false)
    }
  }

  private func setSending(_ sending: Bool) {
    sendButton.isEnabled = !sending
    sending ? activity.startAnimating() : activity.stopAnimating()
  }

  private func load() {
    refreshControl.beginRefreshing()
    Task {
      do {
        async let profileTask = client.me()
        async let chatsTask = client.sessions()
        async let projectsTask = client.projects()
        async let approvalsTask = client.pendingApprovals()
        async let activeTask = client.activeSessions()

        self.profile = try await profileTask
        self.chats = try await chatsTask
        self.projects = try await projectsTask
        self.approvalCount = (try? await approvalsTask)?.count ?? 0
        self.activeIds = Set((try? await activeTask) ?? [])
        renderData()
      } catch APIError.unauthorized {
        onSignedOut?()
      } catch {
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }
}
