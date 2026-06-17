import UIKit

final class SettingsViewController: UIViewController {
  var onSignOut: (() -> Void)?
  var onChangeServer: (() -> Void)?

  private let email: String
  private let serverURL: URL?
  private let tableView = UITableView(frame: .zero, style: .insetGrouped)

  init(email: String, serverURL: URL?) {
    self.email = email
    self.serverURL = serverURL
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Settings"
    view.backgroundColor = AppTheme.canvas

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done, target: self, action: #selector(doneTapped)
    )

    tableView.backgroundColor = AppTheme.canvas
    tableView.dataSource = self
    tableView.delegate = self
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "cell")

    view.addSubview(tableView)
    tableView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      tableView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      tableView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      tableView.topAnchor.constraint(equalTo: view.topAnchor),
      tableView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  @objc private func doneTapped() { dismiss(animated: true) }
}

extension SettingsViewController: UITableViewDataSource, UITableViewDelegate {
  func numberOfSections(in tableView: UITableView) -> Int { 2 }

  func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
    section == 0 ? 2 : 2
  }

  func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
    section == 0 ? "Account" : nil
  }

  func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "cell", for: indexPath)
    cell.backgroundColor = AppTheme.surface

    if indexPath.section == 0 {
      var content = cell.defaultContentConfiguration()
      if indexPath.row == 0 {
        content.text = "Email"
        content.secondaryText = email
      } else {
        content.text = "Server"
        content.secondaryText = serverURL?.host ?? serverURL?.absoluteString ?? "—"
      }
      cell.contentConfiguration = content
      cell.selectionStyle = .none
    } else {
      var content = cell.defaultContentConfiguration()
      if indexPath.row == 0 {
        content.text = "Change Server"
        content.textProperties.color = AppTheme.accent
      } else {
        content.text = "Sign Out"
        content.textProperties.color = .systemRed
      }
      cell.contentConfiguration = content
      cell.selectionStyle = .default
    }
    return cell
  }

  func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard indexPath.section == 1 else { return }
    if indexPath.row == 0 {
      onChangeServer?()
    } else {
      confirmSignOut()
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
