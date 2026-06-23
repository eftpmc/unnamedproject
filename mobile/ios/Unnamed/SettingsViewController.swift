import UIKit
import UserNotifications

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
    removeNavBarBackground()

    tableView.backgroundColor = .systemBackground
    tableView.separatorStyle = .none
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
    if sender.isOn {
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
        DispatchQueue.main.async {
          if granted {
            UIApplication.shared.registerForRemoteNotifications()
          } else {
            sender.setOn(false, animated: true)
            UserDefaults.standard.set(false, forKey: "approvalAlertsEnabled")
          }
        }
      }
    }
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
      var content = UIListContentConfiguration.valueCell()
      if indexPath.row == 0 {
        content.text = "Address"
        content.secondaryText = serverAddressText
        content.secondaryTextProperties.color = .secondaryLabel
        cell.selectionStyle = .none
      } else {
        content = UIListContentConfiguration.cell()
        content.text = "Change Server"
        content.image = UIImage(systemName: "server.rack")
        content.imageProperties.tintColor = AppPalette.accent
        content.textProperties.color = AppPalette.accent
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
      content.image = UIImage(systemName: "bell.badge")
      content.imageProperties.tintColor = AppPalette.accent
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
    var content = UIListContentConfiguration.subtitleCell()
    content.text = email
    content.secondaryText = "Signed in"
    content.image = UIImage(systemName: "person.crop.circle.fill")
    content.imageProperties.tintColor = AppPalette.accent
    content.imageProperties.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 28, weight: .regular)
    content.textProperties.font = .app(forTextStyle: .body, weight: .medium)
    content.secondaryTextProperties.font = .app(forTextStyle: .caption1)
    content.secondaryTextProperties.color = .secondaryLabel
    cell.contentConfiguration = content
    cell.accessoryType = .none
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
