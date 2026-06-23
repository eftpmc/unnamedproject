import UIKit

final class ApprovalsViewController: UIViewController {
  private let appSession: AppSession
  private lazy var client = APIClient(session: appSession)
  private var approvals: [PendingApproval] = []
  private var pollTimer: Timer?

  private let tableView = UITableView(frame: .zero, style: .plain)
  private let refreshControl = UIRefreshControl()
  private let emptyView = UIView()

  init(appSession: AppSession) {
    self.appSession = appSession
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Inbox"
    navigationItem.largeTitleDisplayMode = .always
    view.backgroundColor = .systemBackground
    removeNavBarBackground()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(doneTapped)
    )

    setupTable()
    setupEmptyView()
    load()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    startPolling()
    ApprovalCenter.shared.clear()
  }

  @objc private func doneTapped() {
    dismiss(animated: true)
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    stopPolling()
  }

  deinit { pollTimer?.invalidate() }

  // MARK: - Layout

  private func setupTable() {
    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
    tableView.register(ApprovalCell.self, forCellReuseIdentifier: ApprovalCell.reuseID)
    tableView.dataSource = self
    tableView.delegate = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 112
    tableView.contentInset = UIEdgeInsets(top: 12, left: 0, bottom: 24, right: 0)
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

  private func setupEmptyView() {
    let icon = UIImageView(image: UIImage(systemName: "tray"))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 40),
      icon.heightAnchor.constraint(equalToConstant: 40),
    ])

    let titleLabel = UILabel()
    titleLabel.text = "All clear"
    titleLabel.font = UIFont.app(forTextStyle: .headline)
    titleLabel.textAlignment = .center

    let subtitleLabel = UILabel()
    subtitleLabel.text = "Approvals and agent requests will appear here."
    subtitleLabel.font = UIFont.app(forTextStyle: .subheadline)
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.textAlignment = .center
    subtitleLabel.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [icon, titleLabel, subtitleLabel])
    stack.axis = .vertical
    stack.alignment = .center
    stack.spacing = 8
    stack.setCustomSpacing(14, after: icon)

    emptyView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: emptyView.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: emptyView.centerYAnchor),
      stack.leadingAnchor.constraint(greaterThanOrEqualTo: emptyView.leadingAnchor, constant: 32),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: emptyView.trailingAnchor, constant: -32),
    ])

    view.addSubview(emptyView)
    emptyView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      emptyView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      emptyView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      emptyView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      emptyView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
  }

  // MARK: - Polling

  private func startPolling() {
    pollTimer?.invalidate()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
      guard let self else { return }
      Task { await self.silentLoad() }
    }
  }

  private func stopPolling() {
    pollTimer?.invalidate()
    pollTimer = nil
  }

  // MARK: - Data

  @objc private func refreshPulled() { load() }

  private func load() {
    Task {
      do {
        approvals = try await client.pendingApprovals()
        updateUI()
      } catch {
        showError(error)
      }
      refreshControl.endRefreshing()
    }
  }

  @MainActor
  private func silentLoad() async {
    do {
      approvals = try await client.pendingApprovals()
      updateUI()
    } catch {}
  }

  private func updateUI() {
    emptyView.isHidden = !approvals.isEmpty
    tableView.reloadData()
  }

  func handleApprove(_ approval: PendingApproval) {
    Task {
      do {
        try await client.approveExecution(id: approval.executionId)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        approvals.removeAll { $0.executionId == approval.executionId }
        updateUI()
      } catch {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        showError(error)
      }
    }
  }

  func handleDeny(_ approval: PendingApproval) {
    Task {
      do {
        try await client.rejectExecution(id: approval.executionId)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        approvals.removeAll { $0.executionId == approval.executionId }
        updateUI()
      } catch {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        showError(error)
      }
    }
  }
}

// MARK: - UITableViewDelegate

extension ApprovalsViewController: UITableViewDelegate {
  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    let approval = approvals[indexPath.row]
    let detail = ApprovalDetailViewController(approval: approval)
    detail.onApprove = { [weak self] in self?.handleApprove(approval) }
    detail.onDeny = { [weak self] in self?.handleDeny(approval) }
    let nav = UINavigationController(rootViewController: detail)
    nav.modalPresentationStyle = .pageSheet
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
      sheet.selectedDetentIdentifier = .large
      sheet.prefersGrabberVisible = true
    }
    present(nav, animated: true)
  }
}

// MARK: - UITableViewDataSource

extension ApprovalsViewController: UITableViewDataSource {
  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { approvals.count }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: ApprovalCell.reuseID, for: indexPath) as! ApprovalCell
    let approval = approvals[indexPath.row]
    cell.configure(action: approval.action, summary: approval.payload?.summary)
    cell.onApprove = { [weak self] in self?.handleApprove(approval) }
    cell.onDeny = { [weak self] in self?.handleDeny(approval) }
    return cell
  }
}

// MARK: - ApprovalCell

private final class ApprovalCell: UITableViewCell {
  static let reuseID = "ApprovalCell"

  var onApprove: (() -> Void)?
  var onDeny: (() -> Void)?

  private let approveButton = UIButton(type: .system)
  private let denyButton = UIButton(type: .system)
  private let content = UIListContentView(configuration: UIListContentConfiguration.subtitleCell())

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    buildLayout()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func buildLayout() {
    content.translatesAutoresizingMaskIntoConstraints = false

    approveButton.configuration = .filled()
    approveButton.configuration?.cornerStyle = .capsule
    approveButton.configuration?.baseBackgroundColor = AppPalette.accent
    approveButton.configuration?.baseForegroundColor = AppPalette.accentForeground
    approveButton.configuration?.image = UIImage(systemName: "checkmark")
    approveButton.configuration?.title = "Approve"
    approveButton.configuration?.imagePadding = 5
    approveButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 13, bottom: 8, trailing: 13)
    approveButton.addTarget(self, action: #selector(approveTapped), for: .touchUpInside)

    denyButton.configuration = .borderedTinted()
    denyButton.configuration?.cornerStyle = .capsule
    denyButton.configuration?.baseForegroundColor = .secondaryLabel
    denyButton.configuration?.image = UIImage(systemName: "xmark")
    denyButton.configuration?.title = "Deny"
    denyButton.configuration?.imagePadding = 5
    denyButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 13, bottom: 8, trailing: 13)
    denyButton.addTarget(self, action: #selector(denyTapped), for: .touchUpInside)

    let buttonRow = UIStackView(arrangedSubviews: [approveButton, denyButton, UIView()])
    buttonRow.axis = .horizontal
    buttonRow.spacing = 8

    let stack = UIStackView(arrangedSubviews: [content, buttonRow])
    stack.axis = .vertical
    stack.spacing = 10
    stack.isLayoutMarginsRelativeArrangement = true
    stack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)

    contentView.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      stack.topAnchor.constraint(equalTo: contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])
  }

  func configure(action: String, summary: String?) {
    var config = UIListContentConfiguration.subtitleCell()
    config.text = action
    config.secondaryText = summary
    config.image = UIImage(systemName: "bell.badge")
    config.imageProperties.tintColor = .systemOrange
    config.textProperties.font = .app(forTextStyle: .subheadline, weight: .medium)
    config.textProperties.numberOfLines = 0
    config.secondaryTextProperties.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
    config.secondaryTextProperties.color = .secondaryLabel
    config.secondaryTextProperties.numberOfLines = 2
    content.configuration = config
  }

  @objc private func approveTapped() { onApprove?() }
  @objc private func denyTapped() { onDeny?() }
}
