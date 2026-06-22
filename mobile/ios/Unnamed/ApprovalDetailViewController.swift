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
    view.backgroundColor = .systemBackground
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .close, target: self, action: #selector(closeTapped)
    )
    pairs = approval.payload?.displayPairs ?? []
    setupTableView()
    setupFooter()
  }

  private func setupTableView() {
    tableView.backgroundColor = .systemBackground
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "detail")
    tableView.dataSource = self
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 60
    tableView.allowsSelection = false

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
    approveBtn.configuration?.cornerStyle = .medium
    approveBtn.configuration?.image = UIImage(systemName: "checkmark")
    approveBtn.configuration?.title = "Approve"
    approveBtn.configuration?.imagePadding = 6
    approveBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 0, bottom: 14, trailing: 0)
    approveBtn.addTarget(self, action: #selector(approveTapped), for: .touchUpInside)

    let denyBtn = UIButton(type: .system)
    denyBtn.configuration = .bordered()
    denyBtn.configuration?.cornerStyle = .medium
    denyBtn.configuration?.baseForegroundColor = .systemRed
    denyBtn.configuration?.image = UIImage(systemName: "xmark")
    denyBtn.configuration?.title = "Deny"
    denyBtn.configuration?.imagePadding = 6
    denyBtn.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 0, bottom: 14, trailing: 0)
    denyBtn.addTarget(self, action: #selector(denyTapped), for: .touchUpInside)

    let buttonStack = UIStackView(arrangedSubviews: [denyBtn, approveBtn])
    buttonStack.axis = .horizontal
    buttonStack.spacing = 12
    buttonStack.distribution = .fillEqually

    let footer = UIView(frame: CGRect(x: 0, y: 0, width: 0, height: 88))
    footer.addSubview(buttonStack)
    buttonStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      buttonStack.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 20),
      buttonStack.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -20),
      buttonStack.topAnchor.constraint(equalTo: footer.topAnchor, constant: 16),
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
      content.text = approval.action
      content.secondaryText = approval.payload?.summary
      content.secondaryTextProperties.numberOfLines = 0
      content.image = UIImage(systemName: "bell.badge")
      content.imageProperties.tintColor = .systemOrange
    } else {
      let pair = pairs[indexPath.row]
      content.text = pair.label
      content.secondaryText = pair.value
      content.secondaryTextProperties.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
      content.secondaryTextProperties.color = .secondaryLabel
      content.secondaryTextProperties.numberOfLines = 0
    }

    cell.contentConfiguration = content
    cell.backgroundColor = .secondarySystemBackground
    return cell
  }
}
