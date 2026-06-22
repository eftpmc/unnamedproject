import UIKit

final class FileContentViewController: UIViewController {
  private let appSession: AppSession
  private let projectId: String
  private let entry: FileEntry
  private let client: APIClient

  private let textView = UITextView()
  private let spinner = UIActivityIndicatorView(style: .medium)

  init(appSession: AppSession, projectId: String, entry: FileEntry, client: APIClient) {
    self.appSession = appSession
    self.projectId = projectId
    self.entry = entry
    self.client = client
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = entry.name
    navigationItem.largeTitleDisplayMode = .never
    view.backgroundColor = .systemBackground
    removeNavBarBackground()

    textView.isEditable = false
    textView.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    textView.textColor = .label
    textView.backgroundColor = .systemBackground
    textView.textContainerInset = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
    textView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(textView)

    spinner.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(spinner)

    NSLayoutConstraint.activate([
      textView.topAnchor.constraint(equalTo: view.topAnchor),
      textView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      textView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      textView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])

    spinner.startAnimating()
    load()
  }

  private func load() {
    Task {
      do {
        let result = try await client.projectFile(projectId: projectId, filePath: entry.path)
        spinner.stopAnimating()
        textView.text = result.content
      } catch {
        spinner.stopAnimating()
        textView.text = "Failed to load file: \(error.localizedDescription)"
        textView.textColor = .secondaryLabel
      }
    }
  }
}
