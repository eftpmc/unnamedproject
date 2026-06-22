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

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain,
      target: self,
      action: #selector(composeTapped)
    )

    setupSegmentedControl()
    setupTable()
    setupEmptyState()
    load()
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
      container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
    ])
    segmentedControlContainer = container
  }

  @objc private func segmentChanged() {
    updateContentForSegment()
  }

  private func updateContentForSegment() {
    switch segmentedControl.selectedSegmentIndex {
    case 0:
      tableView.backgroundView = nil
      emptyLabel.isHidden = !chats.isEmpty
    default:
      emptyLabel.isHidden = true
      let title = segmentedControl.selectedSegmentIndex == 1 ? "Plans" : "Files"
      tableView.backgroundView = makeComingSoonView(title: title)
    }
    tableView.reloadData()
  }

  private func makeComingSoonView(title: String) -> UIView {
    let container = UIView()
    let label = UILabel()
    label.text = "Coming soon"
    label.font = UIFont.app(forTextStyle: .subheadline)
    label.textColor = .tertiaryLabel
    label.textAlignment = .center
    container.addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      label.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 32),
      label.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -32),
    ])
    return container
  }

  private func setupEmptyState() {
    emptyLabel.text = "No chats yet.\nTap compose to start one."
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
    tableView.separatorInset = UIEdgeInsets(top: 0, left: 56, bottom: 0, right: 0)
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    tableView.dataSource = self
    tableView.delegate = self
    tableView.tableHeaderView = makeHeaderView()
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

  private func makeHeaderView() -> UIView {
    let wrapper = UIView()
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 6
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16)

    if let desc = project.description, !desc.isEmpty {
      let label = UILabel()
      label.text = desc
      label.font = UIFont.app(forTextStyle: .subheadline)
      label.textColor = .secondaryLabel
      label.numberOfLines = 0
      stack.addArrangedSubview(label)
    }

    if let repo = project.repoPath {
      let repoStack = UIStackView()
      repoStack.axis = .horizontal
      repoStack.spacing = 6
      repoStack.alignment = .center

      let icon = UIImageView(image: UIImage(systemName: "folder"))
      icon.tintColor = .tertiaryLabel
      icon.contentMode = .scaleAspectFit
      NSLayoutConstraint.activate([
        icon.widthAnchor.constraint(equalToConstant: 14),
        icon.heightAnchor.constraint(equalToConstant: 14),
      ])

      let label = UILabel()
      label.text = repo
      label.font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
      label.textColor = .tertiaryLabel
      label.numberOfLines = 1

      repoStack.addArrangedSubview(icon)
      repoStack.addArrangedSubview(label)
      stack.addArrangedSubview(repoStack)
    }

    wrapper.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
      stack.topAnchor.constraint(equalTo: wrapper.topAnchor),
      stack.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor),
    ])

    // Size the header view
    stack.layoutIfNeeded()
    let height = stack.systemLayoutSizeFitting(
      CGSize(width: UIScreen.main.bounds.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel
    ).height
    wrapper.frame = CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: max(height, 1))
    return wrapper
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

    var content = cell.defaultContentConfiguration()
    content.text = chat.title ?? "Untitled"
    let timePart = (chat.updatedAt ?? chat.createdAt).map { relativeTime(from: $0) }
    let metaParts = [chat.model ?? chat.effort, timePart].compactMap { $0 }
    content.secondaryText = metaParts.isEmpty ? nil : metaParts.joined(separator: " · ")
    content.image = UIImage(systemName: "message")
    content.imageProperties.tintColor = isActive ? .systemGreen : .tintColor
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
