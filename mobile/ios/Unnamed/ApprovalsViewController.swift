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
    view.backgroundColor = AppTheme.canvas

    setupTable()
    setupEmptyView()
    load()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    startPolling()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    stopPolling()
  }

  deinit { pollTimer?.invalidate() }

  // MARK: - Layout

  private func setupTable() {
    tableView.backgroundColor = AppTheme.canvas
    tableView.separatorStyle = .none
    tableView.register(ApprovalCell.self, forCellReuseIdentifier: ApprovalCell.reuseID)
    tableView.dataSource = self
    tableView.delegate = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 140
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
    let icon = UIImageView(image: UIImage(systemName: "checkmark.circle"))
    icon.tintColor = .tertiaryLabel
    icon.contentMode = .scaleAspectFit
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.widthAnchor.constraint(equalToConstant: 40),
      icon.heightAnchor.constraint(equalToConstant: 40),
    ])

    let titleLabel = UILabel()
    titleLabel.text = "All clear"
    titleLabel.font = UIFont.preferredFont(forTextStyle: .headline)
    titleLabel.textAlignment = .center

    let subtitleLabel = UILabel()
    subtitleLabel.text = "Approvals and agent requests will appear here."
    subtitleLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
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

  func handleApprove(at index: Int) {
    let approval = approvals[index]
    Task {
      do {
        try await client.approveExecution(id: approval.executionId)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        approvals.remove(at: index)
        updateUI()
      } catch {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        showError(error)
      }
    }
  }

  func handleDeny(at index: Int) {
    let approval = approvals[index]
    Task {
      do {
        try await client.rejectExecution(id: approval.executionId)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        approvals.remove(at: index)
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
    detail.onApprove = { [weak self] in self?.handleApprove(at: indexPath.row) }
    detail.onDeny = { [weak self] in self?.handleDeny(at: indexPath.row) }
    let nav = UINavigationController(rootViewController: detail)
    nav.modalPresentationStyle = .pageSheet
    if let sheet = nav.sheetPresentationController {
      sheet.detents = [.medium(), .large()]
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
    cell.onApprove = { [weak self] in self?.handleApprove(at: indexPath.row) }
    cell.onDeny = { [weak self] in self?.handleDeny(at: indexPath.row) }
    return cell
  }
}

// MARK: - ApprovalCell

private final class ApprovalCell: UITableViewCell {
  static let reuseID = "ApprovalCell"

  var onApprove: (() -> Void)?
  var onDeny: (() -> Void)?

  private let actionLabel = UILabel()
  private let summaryLabel = UILabel()
  private let approveButton = UIButton(type: .system)
  private let denyButton = UIButton(type: .system)

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    buildLayout()
  }

  required init?(coder: NSCoder) { fatalError() }

  private func buildLayout() {
    let card = UIView()
    card.backgroundColor = AppTheme.warning.withAlphaComponent(0.06)
    card.layer.cornerRadius = 16
    card.layer.cornerCurve = .continuous
    card.layer.borderColor = AppTheme.warning.withAlphaComponent(0.3).cgColor
    card.layer.borderWidth = 1

    let iconBadge = IconBadgeView(systemName: "bell.badge", tintColor: AppTheme.warning)

    actionLabel.font = UIFont.preferredFont(forTextStyle: .subheadline)
    actionLabel.adjustsFontForContentSizeCategory = true
    actionLabel.numberOfLines = 0

    summaryLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    summaryLabel.textColor = .secondaryLabel
    summaryLabel.numberOfLines = 1

    let textStack = UIStackView(arrangedSubviews: [actionLabel, summaryLabel])
    textStack.axis = .vertical
    textStack.spacing = 3

    let headerRow = UIStackView(arrangedSubviews: [iconBadge, textStack])
    headerRow.axis = .horizontal
    headerRow.alignment = .top
    headerRow.spacing = 12

    // Approve button
    approveButton.configuration = .filled()
    approveButton.configuration?.cornerStyle = .medium
    approveButton.configuration?.baseBackgroundColor = AppTheme.primary
    approveButton.configuration?.baseForegroundColor = AppTheme.primaryText
    approveButton.configuration?.image = UIImage(systemName: "checkmark")
    approveButton.configuration?.title = "Approve"
    approveButton.configuration?.imagePadding = 5
    approveButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 9, leading: 14, bottom: 9, trailing: 14)
    approveButton.addTarget(self, action: #selector(approveTapped), for: .touchUpInside)

    // Deny button
    denyButton.configuration = .bordered()
    denyButton.configuration?.cornerStyle = .medium
    denyButton.configuration?.baseForegroundColor = .secondaryLabel
    denyButton.configuration?.image = UIImage(systemName: "xmark")
    denyButton.configuration?.title = "Deny"
    denyButton.configuration?.imagePadding = 5
    denyButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 9, leading: 14, bottom: 9, trailing: 14)
    denyButton.addTarget(self, action: #selector(denyTapped), for: .touchUpInside)

    let buttonRow = UIStackView(arrangedSubviews: [approveButton, denyButton, UIView()])
    buttonRow.axis = .horizontal
    buttonRow.spacing = 8

    let divider = UIView()
    divider.backgroundColor = AppTheme.warning.withAlphaComponent(0.15)
    divider.heightAnchor.constraint(equalToConstant: 1).isActive = true

    let cardStack = UIStackView(arrangedSubviews: [headerRow, divider, buttonRow])
    cardStack.axis = .vertical
    cardStack.spacing = 12
    cardStack.isLayoutMarginsRelativeArrangement = true
    cardStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)

    card.addSubview(cardStack)
    cardStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      cardStack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      cardStack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      cardStack.topAnchor.constraint(equalTo: card.topAnchor),
      cardStack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
    ])

    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16),
      card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
      card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -6),
    ])
  }

  func configure(action: String, summary: String?) {
    actionLabel.text = action
    summaryLabel.text = summary
    summaryLabel.isHidden = summary == nil
  }

  @objc private func approveTapped() { onApprove?() }
  @objc private func denyTapped() { onDeny?() }
}
