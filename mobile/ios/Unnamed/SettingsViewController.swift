import UIKit

final class SettingsViewController: UIViewController {
  var onSignOut: (() -> Void)?
  var onChangeServer: (() -> Void)?

  private let email: String
  private let serverURL: URL?
  private let tableView = UITableView(frame: .zero, style: .insetGrouped)

  private enum Section: Int, CaseIterable {
    case account, server, notifications, signOut
  }

  init(email: String, serverURL: URL?) {
    self.email = email
    self.serverURL = serverURL
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Settings"
    view.backgroundColor = .systemBackground
    navigationItem.largeTitleDisplayMode = .always

    tableView.backgroundColor = .systemBackground
    tableView.dataSource = self
    tableView.delegate = self
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "switchCell")

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  private var approvalAlertsEnabled: Bool {
    let defaults = UserDefaults.standard
    if defaults.object(forKey: "approvalAlertsEnabled") == nil { return true }
    return defaults.bool(forKey: "approvalAlertsEnabled")
  }

  @objc private func approvalAlertsToggled(_ sender: UISwitch) {
    UserDefaults.standard.set(sender.isOn, forKey: "approvalAlertsEnabled")
  }
}

extension SettingsViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { Section.allCases.count }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    switch Section(rawValue: section)! {
    case .account: return 1
    case .server: return 2
    case .notifications: return 1
    case .signOut: return 1
    }
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    switch Section(rawValue: section)! {
    case .account: return "Account"
    case .server: return "Server"
    case .notifications: return "Notifications"
    case .signOut: return nil
    }
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    switch Section(rawValue: indexPath.section)! {
    case .account:
      let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
      cell.backgroundColor = .secondarySystemBackground
      cell.selectionStyle = .none
      configureAccountCell(cell)
      return cell

    case .server:
      let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
      cell.backgroundColor = .secondarySystemBackground
      var content = cell.defaultContentConfiguration()
      if indexPath.row == 0 {
        content.text = "Address"
        content.secondaryText = serverAddressText
        cell.selectionStyle = .none
      } else {
        content.text = "Change Server"
        content.textProperties.color = .tintColor
        cell.selectionStyle = .default
      }
      cell.contentConfiguration = content
      cell.accessoryType = .none
      return cell

    case .notifications:
      let cell = tableView.dequeueReusableCell(withIdentifier: "switchCell", for: indexPath)
      cell.backgroundColor = .secondarySystemBackground
      cell.selectionStyle = .none
      var content = cell.defaultContentConfiguration()
      content.text = "Approval Alerts"
      cell.contentConfiguration = content
      let switchView = UISwitch()
      switchView.isOn = approvalAlertsEnabled
      switchView.addTarget(self, action: #selector(approvalAlertsToggled(_:)), for: .valueChanged)
      cell.accessoryView = switchView
      return cell

    case .signOut:
      let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
      cell.backgroundColor = .secondarySystemBackground
      var content = cell.defaultContentConfiguration()
      content.text = "Sign Out"
      content.textProperties.color = .systemRed
      content.textProperties.alignment = .center
      cell.contentConfiguration = content
      cell.selectionStyle = .default
      return cell
    }
  }

  private var serverAddressText: String {
    guard let serverURL else { return "—" }
    guard let host = serverURL.host else { return serverURL.absoluteString }
    if let port = serverURL.port {
      return "\(host):\(port)"
    }
    return host
  }

  private func configureAccountCell(_ cell: UITableViewCell) {
    cell.contentView.subviews.forEach { $0.removeFromSuperview() }

    let avatar = UILabel()
    avatar.backgroundColor = .tintColor
    avatar.textColor = .white
    avatar.font = .systemFont(ofSize: 14, weight: .semibold)
    avatar.textAlignment = .center
    avatar.layer.cornerRadius = 16
    avatar.clipsToBounds = true
    avatar.text = email.first.map { String($0).uppercased() } ?? "•"
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.widthAnchor.constraint(equalToConstant: 32).isActive = true
    avatar.heightAnchor.constraint(equalToConstant: 32).isActive = true

    let emailLabel = UILabel()
    emailLabel.font = UIFont.preferredFont(forTextStyle: .body)
    emailLabel.textColor = .label
    emailLabel.text = email

    let stack = UIStackView(arrangedSubviews: [avatar, emailLabel])
    stack.axis = .horizontal
    stack.spacing = 10
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false

    cell.contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: cell.contentView.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(lessThanOrEqualTo: cell.contentView.trailingAnchor, constant: -16),
      stack.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 8),
      stack.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -8),
    ])
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    switch Section(rawValue: indexPath.section)! {
    case .server where indexPath.row == 1:
      onChangeServer?()
    case .signOut:
      confirmSignOut()
    default:
      break
    }
  }

  private func confirmSignOut() {
    let alert = UIAlertController(title: "Sign Out", message: "You'll need to sign in again to use the app.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Sign Out", style: .destructive) { [weak self] _ in
      self?.onSignOut?()
    })
    present(alert, animated: true)
  }
}
