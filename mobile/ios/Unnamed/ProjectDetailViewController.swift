import UIKit

final class ProjectDetailViewController: UIViewController {
  var onShowChat: ((ChatSession) -> Void)?

  private let appSession: AppSession
  private let project: Project
  private lazy var client = APIClient(session: appSession)

  private var chats: [ChatSession] = []
  private var activeIds: Set<String> = []
  private var plans: [Plan] = []
  private var artifacts: [ProjectArtifact] = []
  private var treeItems: [TreeItem] = []

  private struct TreeItem {
    let entry: FileEntry
    let depth: Int
    var isExpanded: Bool = false
    var isLoading: Bool = false
  }

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()
  private let emptyLabel = UILabel()
  private let segmentedControl = UISegmentedControl(items: ["Chats", "Plans", "Artifacts", "Files"])
  private var segmentedControlContainer: UIView!
  private var projectInfoContainer: UIView!
  private var hasLoaded = false
  private var plansLoaded = false
  private var artifactsLoaded = false
  private var treeLoaded = false

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
    emptyLabel.isHidden = true
    switch segmentedControl.selectedSegmentIndex {
    case 0:
      tableView.backgroundView = hasLoaded && chats.isEmpty ? makeEmptyChatsView() : nil
      tableView.reloadData()
    case 1:
      if !plansLoaded {
        tableView.backgroundView = makeLoadingView()
        tableView.reloadData()
        loadPlans()
      } else {
        tableView.backgroundView = plans.isEmpty ? makeEmptyView(
          systemName: "list.bullet.clipboard",
          title: "No plans yet",
          subtitle: "Plans created in project chats will appear here."
        ) : nil
        tableView.reloadData()
      }
    case 2:
      if !artifactsLoaded {
        tableView.backgroundView = makeLoadingView()
        tableView.reloadData()
        loadArtifacts()
      } else {
        tableView.backgroundView = artifacts.isEmpty ? makeEmptyView(
          systemName: "shippingbox",
          title: "No artifacts yet",
          subtitle: "Durable outputs produced by agents will appear here."
        ) : nil
        tableView.reloadData()
      }
    case 3:
      if !treeLoaded {
        tableView.backgroundView = makeLoadingView()
        tableView.reloadData()
        loadTree()
      } else {
        tableView.backgroundView = treeItems.isEmpty ? makeEmptyView(
          systemName: "doc",
          title: "No files found",
          subtitle: "Files from the linked repository will appear here."
        ) : nil
        tableView.reloadData()
      }
    default:
      tableView.reloadData()
    }
  }

  private func loadPlans() {
    Task {
      let loaded = (try? await client.projectPlans(projectId: project.id)) ?? []
      plans = loaded.sorted { $0.createdAt > $1.createdAt }
      plansLoaded = true
      if segmentedControl.selectedSegmentIndex == 1 {
        tableView.backgroundView = plans.isEmpty ? makeEmptyView(
          systemName: "list.bullet.clipboard",
          title: "No plans yet",
          subtitle: "Plans created in project chats will appear here."
        ) : nil
        tableView.reloadData()
      }
    }
  }

  private func loadArtifacts() {
    Task {
      let loaded = (try? await client.projectArtifacts(projectId: project.id)) ?? []
      artifacts = loaded.sorted { $0.createdAt > $1.createdAt }
      artifactsLoaded = true
      if segmentedControl.selectedSegmentIndex == 2 {
        tableView.backgroundView = artifacts.isEmpty ? makeEmptyView(
          systemName: "shippingbox",
          title: "No artifacts yet",
          subtitle: "Durable outputs produced by agents will appear here."
        ) : nil
        tableView.reloadData()
      }
    }
  }

  private func loadTree() {
    Task {
      guard let result = try? await client.projectTree(projectId: project.id) else {
        treeLoaded = true
        if segmentedControl.selectedSegmentIndex == 3 {
          tableView.backgroundView = makeEmptyView(systemName: "doc", title: "No files found", subtitle: "Files from the linked repository will appear here.")
          tableView.reloadData()
        }
        return
      }
      let sorted = result.entries.sorted { a, b in a.isDir != b.isDir ? a.isDir : a.name < b.name }
      treeItems = sorted.map { TreeItem(entry: $0, depth: 0) }
      treeLoaded = true
      if segmentedControl.selectedSegmentIndex == 3 {
        tableView.backgroundView = treeItems.isEmpty ? makeEmptyView(systemName: "doc", title: "No files found", subtitle: "Files from the linked repository will appear here.") : nil
        tableView.reloadData()
      }
    }
  }

  private func toggleFolder(at index: Int) {
    guard treeItems[index].entry.isDir else { return }

    if treeItems[index].isExpanded {
      // Collapse: remove all descendants
      let depth = treeItems[index].depth
      var end = index + 1
      while end < treeItems.count && treeItems[end].depth > depth { end += 1 }
      let removedPaths = (index + 1 ..< end).map { IndexPath(row: $0, section: 0) }
      treeItems.removeSubrange(index + 1 ..< end)
      treeItems[index].isExpanded = false
      tableView.performBatchUpdates {
        tableView.deleteRows(at: removedPaths, with: .fade)
        tableView.reloadRows(at: [IndexPath(row: index, section: 0)], with: .none)
      }
    } else {
      // Expand: load children
      treeItems[index].isLoading = true
      tableView.reloadRows(at: [IndexPath(row: index, section: 0)], with: .none)
      let path = treeItems[index].entry.path
      let insertDepth = treeItems[index].depth + 1
      Task {
        guard let result = try? await client.projectTree(projectId: project.id, dirPath: path) else {
          treeItems[index].isLoading = false
          tableView.reloadRows(at: [IndexPath(row: index, section: 0)], with: .none)
          return
        }
        let sorted = result.entries.sorted { a, b in a.isDir != b.isDir ? a.isDir : a.name < b.name }
        let children = sorted.map { TreeItem(entry: $0, depth: insertDepth) }
        treeItems[index].isExpanded = true
        treeItems[index].isLoading = false
        treeItems.insert(contentsOf: children, at: index + 1)
        let insertedPaths = (1 ... max(1, children.count)).map { IndexPath(row: index + $0, section: 0) }
        tableView.performBatchUpdates {
          if !children.isEmpty { tableView.insertRows(at: insertedPaths, with: .fade) }
          tableView.reloadRows(at: [IndexPath(row: index, section: 0)], with: .none)
        }
      }
    }
  }

  private func makeEmptyView(systemName: String, title: String, subtitle subtitleText: String) -> UIView {
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
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "planCell")
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "artifactCell")
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "treeCell")
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
    label.text = URL(fileURLWithPath: repo).lastPathComponent
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
    switch segmentedControl.selectedSegmentIndex {
    case 0: return chats.count
    case 1: return plans.count
    case 2: return artifacts.count
    case 3: return treeItems.count
    default: return 0
    }
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    switch segmentedControl.selectedSegmentIndex {
    case 1: return planCell(at: indexPath)
    case 2: return artifactCell(at: indexPath)
    case 3: return treeCell(at: indexPath)
    default: return chatCell(at: indexPath)
    }
  }

  private func chatCell(at indexPath: IndexPath) -> UITableViewCell {
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

  private func planCell(at indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "planCell", for: indexPath)
    let plan = plans[indexPath.row]
    var content = UIListContentConfiguration.subtitleCell()
    content.text = plan.title
    content.textProperties.font = .app(ofSize: 15, weight: .medium)
    content.secondaryText = relativeTime(from: Int(plan.createdAt))
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    content.image = UIImage(systemName: planIcon(for: plan.status))
    content.imageProperties.tintColor = planColor(for: plan.status)
    cell.contentConfiguration = content
    cell.backgroundColor = .systemBackground
    cell.accessoryView = nil
    cell.accessoryType = .disclosureIndicator
    return cell
  }

  private func artifactCell(at indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "artifactCell", for: indexPath)
    let artifact = artifacts[indexPath.row]
    var content = UIListContentConfiguration.subtitleCell()
    content.text = artifact.title
    content.textProperties.font = .app(ofSize: 15, weight: .medium)
    let parts = [kindLabel(for: artifact.kind), artifact.mimeType, relativeTime(from: artifact.createdAt)]
    content.secondaryText = parts.joined(separator: " · ")
    content.secondaryTextProperties.font = .app(ofSize: 12)
    content.secondaryTextProperties.color = .secondaryLabel
    content.image = UIImage(systemName: artifactIcon(for: artifact))
    content.imageProperties.tintColor = artifactColor(for: artifact.status)
    cell.contentConfiguration = content
    cell.backgroundColor = .systemBackground
    cell.accessoryView = nil
    cell.accessoryType = .disclosureIndicator
    return cell
  }

  private func kindLabel(for kind: String) -> String {
    kind
      .replacingOccurrences(of: "_", with: " ")
      .replacingOccurrences(of: "-", with: " ")
      .split(separator: " ")
      .map { $0.capitalized }
      .joined(separator: " ")
  }

  private func artifactIcon(for artifact: ProjectArtifact) -> String {
    if artifact.isVideo { return "play.rectangle" }
    if artifact.isImage { return "photo" }
    if artifact.isText { return "doc.text" }
    return "shippingbox"
  }

  private func artifactColor(for status: String) -> UIColor {
    switch status {
    case "ready": return AppPalette.success
    case "review": return AppPalette.warning
    case "running": return AppPalette.accent
    case "error": return .systemRed
    default: return .secondaryLabel
    }
  }

  private func treeCell(at indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "treeCell", for: indexPath)
    let item = treeItems[indexPath.row]
    var content = UIListContentConfiguration.cell()
    content.text = item.entry.name
    content.textProperties.font = .app(ofSize: 14, weight: item.entry.isDir ? .medium : .regular)
    content.directionalLayoutMargins.leading = CGFloat(12 + item.depth * 20)
    if item.isLoading {
      content.image = UIImage(systemName: "ellipsis")
      content.imageProperties.tintColor = .secondaryLabel
      cell.accessoryType = .none
      cell.accessoryView = nil
    } else if item.entry.isDir {
      content.image = UIImage(systemName: item.isExpanded ? "chevron.down" : "chevron.right")
      content.imageProperties.tintColor = .secondaryLabel
      content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .medium)
      cell.accessoryType = .none
      cell.accessoryView = nil
    } else {
      content.image = UIImage(systemName: "doc.text")
      content.imageProperties.tintColor = .secondaryLabel
      content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 14, weight: .regular)
      cell.accessoryType = .disclosureIndicator
      cell.accessoryView = nil
    }
    cell.contentConfiguration = content
    cell.backgroundColor = .systemBackground
    return cell
  }

  private func planIcon(for status: String) -> String {
    switch status {
    case "done": return "checkmark.circle.fill"
    case "error": return "exclamationmark.circle.fill"
    case "running": return "arrow.trianglehead.2.clockwise.rotate.90.circle.fill"
    case "cancelled": return "slash.circle.fill"
    default: return "circle"
    }
  }

  private func planColor(for status: String) -> UIColor {
    switch status {
    case "done": return AppPalette.success
    case "error": return .systemRed
    case "running": return AppPalette.accent
    case "cancelled": return .secondaryLabel
    default: return .tertiaryLabel
    }
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    switch segmentedControl.selectedSegmentIndex {
    case 0:
      onShowChat?(chats[indexPath.row])
    case 1:
      break
    case 2:
      pushArtifactContent(artifact: artifacts[indexPath.row])
    case 3:
      let item = treeItems[indexPath.row]
      if item.entry.isDir {
        toggleFolder(at: indexPath.row)
      } else {
        pushFileContent(entry: item.entry)
      }
    default:
      break
    }
  }

  private func pushFileContent(entry: FileEntry) {
    let vc = FileContentViewController(appSession: appSession, projectId: project.id, entry: entry, client: client)
    navigationController?.pushViewController(vc, animated: true)
  }

  private func pushArtifactContent(artifact: ProjectArtifact) {
    let vc = ArtifactContentViewController(artifact: artifact, client: client)
    navigationController?.pushViewController(vc, animated: true)
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
