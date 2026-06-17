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

  init(appSession: AppSession, project: Project) {
    self.appSession = appSession
    self.project = project
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = project.name
    view.backgroundColor = AppTheme.canvas

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.pencil"),
      style: .plain,
      target: self,
      action: #selector(composeTapped)
    )

    setupTable()
    load()
  }

  private func setupTable() {
    tableView.backgroundColor = AppTheme.canvas
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
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
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
      label.font = UIFont.preferredFont(forTextStyle: .subheadline)
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

    let divider = UIView()
    divider.backgroundColor = AppTheme.border
    divider.heightAnchor.constraint(equalToConstant: 0.5).isActive = true

    let sectionLabel = UILabel()
    sectionLabel.text = "CHATS"
    sectionLabel.font = UIFont.preferredFont(forTextStyle: .caption1)
    sectionLabel.textColor = .secondaryLabel

    let bottomStack = UIStackView()
    bottomStack.axis = .vertical
    bottomStack.spacing = 0
    bottomStack.addArrangedSubview(divider)

    let sectionWrapper = UIStackView(arrangedSubviews: [sectionLabel])
    sectionWrapper.isLayoutMarginsRelativeArrangement = true
    sectionWrapper.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 4, trailing: 16)
    bottomStack.addArrangedSubview(sectionWrapper)

    let outerStack = UIStackView(arrangedSubviews: [stack, bottomStack])
    outerStack.axis = .vertical
    outerStack.spacing = 0

    wrapper.addSubview(outerStack)
    outerStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      outerStack.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor),
      outerStack.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor),
      outerStack.topAnchor.constraint(equalTo: wrapper.topAnchor),
      outerStack.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor),
    ])

    // Size the header view
    outerStack.layoutIfNeeded()
    let height = outerStack.systemLayoutSizeFitting(
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
        tableView.reloadData()
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
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { chats.count }

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
    content.imageProperties.tintColor = isActive ? .systemGreen : AppTheme.accent
    cell.contentConfiguration = content
    cell.backgroundColor = AppTheme.canvas

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
