import UIKit

final class ProjectDetailViewController: UIViewController {
  var onShowChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private let project: Project
  private lazy var client = APIClient(session: appSession)

  private var chats: [ChatSession] = []
  private var activeIds: Set<String> = []

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()
  private let emptyLabel = UILabel()
  private let segmentedControl = UISegmentedControl(items: ["Chats", "Plans", "Files"])
  private var segmentedControlContainer: UIView!
  private var projectInfoContainer: UIView!
  private var hasLoaded = false

  init(appSession: AppSession, project: Project) {
    self.appSession = appSession
    self.project = project
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = project.name
    // Detail screen: compact title even though the shell allows large titles.
    navigationItem.largeTitleDisplayMode = .never
    view.backgroundColor = .systemBackground
    removeNavBarBackground()

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain,
      target: self,
      action: #selector(composeTapped)
    )

    setupProjectInfo()
    setupSegmentedControl()
    setupTable()
    setupEmptyState()
    load()
  }

  private func setupProjectInfo() {
    let container = UIView()
    container.backgroundColor = .systemBackground
    view.addSubview(container)
    container.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    projectInfoContainer = container
    populateInfoView()
  }

  private func populateInfoView() {
    projectInfoContainer.subviews.forEach { $0.removeFromSuperview() }
    let stack = makeInfoStack()
    projectInfoContainer.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: projectInfoContainer.topAnchor),
      stack.leadingAnchor.constraint(equalTo: projectInfoContainer.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: projectInfoContainer.trailingAnchor),
      stack.bottomAnchor.constraint(equalTo: projectInfoContainer.bottomAnchor),
    ])
  }

  private func makeInfoStack() -> UIStackView {
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 10
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16)

    let metaRow = UIStackView()
    metaRow.axis = .horizontal
    metaRow.spacing = 8
    metaRow.alignment = .center
    metaRow.addArrangedSubview(makeMetricPill(icon: "bubble.left.and.bubble.right", text: chatCountText))
    if activeCount > 0 {
      metaRow.addArrangedSubview(makeMetricPill(icon: "dot.radiowaves.left.and.right", text: "\(activeCount) active", tintColor: AppPalette.success))
    }
    if let created = project.createdAt {
      metaRow.addArrangedSubview(makeMetricPill(icon: "calendar", text: relativeTime(from: created)))
    }
    metaRow.addArrangedSubview(UIView())
    stack.addArrangedSubview(metaRow)

    if let desc = project.description, !desc.isEmpty {
      let label = UILabel()
      label.text = desc
      label.font = UIFont.app(forTextStyle: .subheadline)
      label.textColor = .secondaryLabel
      label.numberOfLines = 0
      stack.addArrangedSubview(label)
    }

    if let repo = project.repoPath {
      stack.addArrangedSubview(makeRepoRow(repo))
    }

    return stack
  }

  private func setupSegmentedControl() {
    segmentedControl.selectedSegmentIndex = 0
    segmentedControl.addTarget(self, action: #selector(segmentChanged), for: .valueChanged)

    let container = UIView()
    container.backgroundColor = .systemBackground
    container.addSubview(segmentedControl)
    segmentedControl.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      segmentedControl.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
      segmentedControl.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
      segmentedControl.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
      segmentedControl.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
    ])

    view.addSubview(container)
    container.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      container.topAnchor.constraint(equalTo: projectInfoContainer.bottomAnchor),
    ])
    segmentedControlContainer = container
  }

  @objc private func segmentChanged() {
    updateContentForSegment()
  }

  private func updateContentForSegment() {
    switch segmentedControl.selectedSegmentIndex {
    case 0:
      emptyLabel.isHidden = true
      tableView.backgroundView = hasLoaded && chats.isEmpty ? makeEmptyChatsView() : nil
    default:
      emptyLabel.isHidden = true
      let isPlans = segmentedControl.selectedSegmentIndex == 1
      tableView.backgroundView = makeComingSoonView(
        systemName: isPlans ? "list.bullet.clipboard" : "doc",
        title: isPlans ? "Plans coming soon" : "Files coming soon",
        subtitle: isPlans ? "Project plans will collect longer-running work." : "Files linked to this project will appear here."
      )
    }
    tableView.reloadData()
  }

  private func makeComingSoonView(systemName: String, title: String, subtitle subtitleText: String) -> UIView {
    let container = UIView()
    let icon = UIImageView(image: UIImage(systemName: systemName))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 36),
      icon.heightAnchor.constraint(equalToConstant: 36),
    ])

    let label = UILabel()
    label.text = title
    label.font = UIFont.app(forTextStyle: .headline)
    label.textColor = .secondaryLabel
    label.textAlignment = .center

    let subtitle = UILabel()
    subtitle.text = subtitleText
    subtitle.font = UIFont.app(forTextStyle: .subheadline)
    subtitle.textColor = .tertiaryLabel
    subtitle.textAlignment = .center
    subtitle.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [icon, label, subtitle])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 8
    stack.setCustomSpacing(14, after: icon)
    container.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
    ])
    return container
  }

  private func makeLoadingView() -> UIView {
    let container = UIView()
    let spinner = UIActivityIndicatorView(style: .medium)
    spinner.startAnimating()
    container.addSubview(spinner)
    spinner.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      spinner.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    return container
  }

  private func makeEmptyChatsView() -> UIView {
    let container = UIView()
    let icon = UIImageView(image: UIImage(systemName: "bubble.left.and.bubble.right"))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 38),
      icon.heightAnchor.constraint(equalToConstant: 38),
    ])

    let title = UILabel()
    title.text = "No chats yet"
    title.font = .app(forTextStyle: .headline)
    title.textAlignment = .center

    let subtitle = UILabel()
    subtitle.text = "Start a project chat with the compose button."
    subtitle.font = .app(forTextStyle: .subheadline)
    subtitle.textColor = .secondaryLabel
    subtitle.textAlignment = .center
    subtitle.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [icon, title, subtitle])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 8
    stack.setCustomSpacing(14, after: icon)
    container.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
    ])
    return container
  }

  private func setupEmptyState() {
    emptyLabel.text = nil
    emptyLabel.numberOfLines = 0
    emptyLabel.textAlignment = .center
    emptyLabel.font = UIFont.app(forTextStyle: .subheadline)
    emptyLabel.textColor = .tertiaryLabel
    emptyLabel.isHidden = true

    view.addSubview(emptyLabel)
    emptyLabel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      emptyLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      emptyLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      emptyLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      emptyLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
    ])
  }

  private func setupTable() {
    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.backgroundView = makeLoadingView()
    tableView.refreshControl = refreshControl
    refreshControl.addTarget(self, action: #selector(refreshPulled), for: .valueChanged)

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.topAnchor.constraint(equalTo: segmentedControlContainer.bottomAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  private var activeCount: Int {
    chats.filter { activeIds.contains($0.id) }.count
  }

  private var chatCountText: String {
    chats.count == 1 ? "1 chat" : "\(chats.count) chats"
  }

  private func makeMetricPill(icon: String, text: String, tintColor: UIColor = .secondaryLabel) -> UIView {
    let imageView = UIImageView(image: UIImage(systemName: icon))
    imageView.tintColor = tintColor
    imageView.contentMode = .scaleAspectFit
    imageView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      imageView.widthAnchor.constraint(equalToConstant: 13),
      imageView.heightAnchor.constraint(equalToConstant: 13),
    ])

    let label = UILabel()
    label.text = text
    label.font = .app(ofSize: 12, weight: .medium)
    label.textColor = tintColor

    let stack = UIStackView(arrangedSubviews: [imageView, label])
    stack.axis = .horizontal
    stack.spacing = 5
    stack.alignment = .center
    return stack
  }

  private func makeRepoRow(_ repo: String) -> UIView {
    let icon = UIImageView(image: UIImage(systemName: "folder"))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 14),
      icon.heightAnchor.constraint(equalToConstant: 14),
    ])

    let label = UILabel()
    label.text = repo
    label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    label.textColor = .tertiaryLabel
    label.numberOfLines = 1
    label.lineBreakMode = .byTruncatingMiddle

    let repoStack = UIStackView(arrangedSubviews: [icon, label])
    repoStack.axis = .horizontal
    repoStack.spacing = 6
    repoStack.alignment = .center
    return repoStack
  }

  private func refreshHeader() {
    populateInfoView()
  }

  @objc private func refreshPulled() { load() }

  private func load() {
    Task {
      do {
        async let all = client.sessions()
        async let active = client.activeSessions()
        let sessions = try await all
        activeIds = Set(try await active)
        chats = sessions.filter { $0.pinnedProjectId == project.id }
        hasLoaded = true
        refreshHeader()
        updateContentForSegment()
      } catch {
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }

  @objc private func composeTapped() {
    navigationItem.rightBarButtonItem?.isEnabled = false
    Task {
      do {
        let created = try await client.createSession(title: project.name)
        try await client.pinSessionToProject(sessionId: created.id, projectId: project.id)
        let chat = ChatSession(
          id: created.id, title: project.name,
          effort: nil, model: nil, pinnedProjectId: project.id,
          createdAt: nil, updatedAt: nil
        )
        onShowChat?(chat)
      } catch {
        showError(error)
      }
      navigationItem.rightBarButtonItem?.isEnabled = true
    }
  }
}

extension ProjectDetailViewController: UITableViewDataSource, UITableViewDelegate {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    segmentedControl.selectedSegmentIndex == 0 ? chats.count : 0
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    let chat = chats[indexPath.row]
    let isActive = activeIds.contains(chat.id)

    var content = UIListContentConfiguration.subtitleCell()
    content.text = chat.title ?? "Untitled"
    content.textProperties.font = .app(ofSize: 15, weight: .medium)
    let timePart = (chat.updatedAt ?? chat.createdAt).map { relativeTime(from: $0) }
    let metaParts = [chat.model ?? chat.effort, timePart].compactMap { $0 }
    content.secondaryText = metaParts.isEmpty ? nil : metaParts.joined(separator: " · ")
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    content.image = UIImage(systemName: "message")
    content.imageProperties.tintColor = isActive ? AppPalette.success : AppPalette.accent
    cell.contentConfiguration = content
    cell.backgroundColor = .systemBackground

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
    onShowChat?(chats[indexPath.row])
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
