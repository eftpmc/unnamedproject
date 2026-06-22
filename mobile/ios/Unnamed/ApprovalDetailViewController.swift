import UIKit

final class ApprovalDetailViewController: UIViewController {
  var onApprove: (() -> Void)?
  var onDeny: (() -> Void)?

  private let approval: PendingApproval
  private let tableView = UITableView(frame: .zero, style: .insetGrouped)
  private var pairs: [(label: String, value: String)] = []

  init(approval: PendingApproval) {
    self.approval = approval
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = approval.action
    view.backgroundColor = .systemGroupedBackground
    removeNavBarBackground()
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(closeTapped)
    )
    pairs = approval.payload?.displayPairs ?? []
    setupTableView()
    setupFooter()
  }

  private func setupTableView() {
    tableView.backgroundColor = .systemGroupedBackground
    tableView.separatorStyle = .none
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "detail")
    tableView.dataSource = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 68
    tableView.allowsSelection = false
    tableView.contentInset = UIEdgeInsets(top: 8, left: 0, bottom: 10, right: 0)

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  private func setupFooter() {
    let approveBtn = UIButton(type: .system)
    approveBtn.configuration = .filled()
    approveBtn.configuration?.cornerStyle = .capsule
    approveBtn.configuration?.baseBackgroundColor = AppPalette.accent
    approveBtn.configuration?.baseForegroundColor = AppPalette.accentForeground
    approveBtn.configuration?.image = UIImage(systemName: "checkmark")
    approveBtn.configuration?.title = "Approve"
    approveBtn.configuration?.imagePadding = 6
    approveBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
    approveBtn.addTarget(self, action: #selector(approveTapped), for: .touchUpInside)

    let denyBtn = UIButton(type: .system)
    denyBtn.configuration = .borderedTinted()
    denyBtn.configuration?.cornerStyle = .capsule
    denyBtn.configuration?.baseForegroundColor = AppPalette.destructive
    denyBtn.configuration?.image = UIImage(systemName: "xmark")
    denyBtn.configuration?.title = "Deny"
    denyBtn.configuration?.imagePadding = 6
    denyBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
    denyBtn.addTarget(self, action: #selector(denyTapped), for: .touchUpInside)

    let buttonStack = UIStackView(arrangedSubviews: [denyBtn, approveBtn])
    buttonStack.axis = .horizontal
    buttonStack.spacing = 12
    buttonStack.distribution = .fillEqually

    let footer = UIView(frame: CGRect(x: 0, y: 0, width: 0, height: 82))
    footer.addSubview(buttonStack)
    buttonStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      buttonStack.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 20),
      buttonStack.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -20),
      buttonStack.topAnchor.constraint(equalTo: footer.topAnchor, constant: 14),
    ])
    tableView.tableFooterView = footer
  }

  @objc private func closeTapped() { dismiss(animated: true) }

  @objc private func approveTapped() {
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    dismiss(animated: true) { self.onApprove?() }
  }

  @objc private func denyTapped() {
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    dismiss(animated: true) { self.onDeny?() }
  }
}

// MARK: - UITableViewDataSource

extension ApprovalDetailViewController: UITableViewDataSource {
  func numberOfSections(in tableView: UITableView) -> Int {
    pairs.isEmpty ? 1 : 2
  }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    section == 0 ? 1 : pairs.count
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    section == 0 ? "Action" : "Details"
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "detail", for: indexPath)
    var content = cell.defaultContentConfiguration()

    if indexPath.section == 0 {
      content = UIListContentConfiguration.subtitleCell()
      content.text = approval.action
      content.secondaryText = approval.payload?.summary
      content.textProperties.font = .app(forTextStyle: .headline, weight: .semibold)
      content.secondaryTextProperties.numberOfLines = 0
      content.secondaryTextProperties.font = .app(forTextStyle: .subheadline)
      content.secondaryTextProperties.color = .secondaryLabel
      content.image = UIImage(systemName: "bell.badge")
      content.imageProperties.tintColor = .systemOrange
      content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 24, weight: .regular)
    } else {
      let pair = pairs[indexPath.row]
      content = UIListContentConfiguration.subtitleCell()
      content.text = pair.label
      content.secondaryText = pair.value
      content.textProperties.font = .app(forTextStyle: .subheadline, weight: .medium)
      content.textProperties.color = .secondaryLabel
      content.secondaryTextProperties.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
      content.secondaryTextProperties.color = .label
      content.secondaryTextProperties.numberOfLines = 0
    }

    cell.contentConfiguration = content
    cell.backgroundColor = .secondarySystemGroupedBackground
    return cell
  }
}
