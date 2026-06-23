import UIKit

final class ArtifactContentViewController: UIViewController {
  private let artifact: ProjectArtifact
  private let client: APIClient

  private let scrollView = UIScrollView()
  private let contentStack = UIStackView()
  private let textView = UITextView()
  private let imageView = UIImageView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private var loadedData: Data?

  init(artifact: ProjectArtifact, client: APIClient) {
    self.artifact = artifact
    self.client = client
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError() }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = artifact.title
    navigationItem.largeTitleDisplayMode = .never
    view.backgroundColor = .systemBackground
    removeNavBarBackground()

    navigationItem.rightBarButtonItem = UIBarButtonItem(
      image: UIImage(systemName: "square.and.arrow.up"),
      style: .plain,
      target: self,
      action: #selector(shareTapped)
    )
    navigationItem.rightBarButtonItem?.isEnabled = false

    setupLayout()
    load()
  }

  private func setupLayout() {
    contentStack.axis = .vertical
    contentStack.spacing = 14
    contentStack.isLayoutMarginsRelativeArrangement = true
    contentStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 16, leading: 16, bottom: 24, trailing: 16)

    let metaLabel = UILabel()
    metaLabel.numberOfLines = 0
    metaLabel.font = UIFont.app(forTextStyle: .caption1)
    metaLabel.textColor = .secondaryLabel
    metaLabel.text = [kindLabel(artifact.kind), artifact.mimeType, relativeTime(from: artifact.createdAt)].joined(separator: " · ")
    contentStack.addArrangedSubview(metaLabel)

    if let description = artifact.description, !description.isEmpty {
      let descriptionLabel = UILabel()
      descriptionLabel.numberOfLines = 0
      descriptionLabel.font = UIFont.app(forTextStyle: .subheadline)
      descriptionLabel.textColor = AppPalette.foregroundSoft
      descriptionLabel.text = description
      contentStack.addArrangedSubview(descriptionLabel)
    }

    textView.isEditable = false
    textView.isScrollEnabled = false
    textView.backgroundColor = .clear
    textView.textContainerInset = .zero
    textView.textContainer.lineFragmentPadding = 0

    imageView.contentMode = .scaleAspectFit
    imageView.clipsToBounds = true
    imageView.layer.cornerRadius = 10
    imageView.layer.borderWidth = 1
    imageView.layer.borderColor = AppPalette.borderSoft.cgColor

    scrollView.addSubview(contentStack)
    view.addSubview(scrollView)
    view.addSubview(spinner)
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    contentStack.translatesAutoresizingMaskIntoConstraints = false
    spinner.translatesAutoresizingMaskIntoConstraints = false

    NSLayoutConstraint.activate([
      scrollView.topAnchor.constraint(equalTo: view.topAnchor),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
      contentStack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
      contentStack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
      contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
      contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),
      spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
  }

  private func load() {
    spinner.startAnimating()
    Task {
      do {
        if artifact.isText, let contentUrl = artifact.contentUrl {
          let content = try await client.artifactContent(contentUrl)
          spinner.stopAnimating()
          showText(content)
        } else if artifact.isImage, let url = artifact.url {
          let data = try await client.artifactData(url)
          loadedData = data
          spinner.stopAnimating()
          showImage(data)
          navigationItem.rightBarButtonItem?.isEnabled = true
        } else if let url = artifact.url ?? artifact.contentUrl {
          let data = try await client.artifactData(url)
          loadedData = data
          spinner.stopAnimating()
          showDownloadOnly()
          navigationItem.rightBarButtonItem?.isEnabled = true
        } else {
          spinner.stopAnimating()
          showMessage("No preview available.")
        }
      } catch {
        spinner.stopAnimating()
        showMessage("Failed to load artifact: \(error.localizedDescription)")
      }
    }
  }

  private func showText(_ content: String) {
    textView.attributedText = markdownAttributedString(
      content,
      baseFont: UIFont.app(forTextStyle: .callout),
      textColor: AppPalette.foregroundSoft,
      codeBg: AppPalette.muted,
      lineSpacing: 4
    )
    contentStack.addArrangedSubview(textView)
  }

  private func showImage(_ data: Data) {
    guard let image = UIImage(data: data) else {
      showMessage("The image could not be decoded.")
      return
    }
    imageView.image = image
    contentStack.addArrangedSubview(imageView)
    imageView.heightAnchor.constraint(equalTo: imageView.widthAnchor, multiplier: image.size.height / max(image.size.width, 1)).isActive = true
  }

  private func showDownloadOnly() {
    showMessage(artifact.isVideo ? "Video preview is available after sharing or saving the file." : "No preview available for this artifact type.")
  }

  private func showMessage(_ message: String) {
    let label = UILabel()
    label.numberOfLines = 0
    label.textAlignment = .center
    label.font = UIFont.app(forTextStyle: .subheadline)
    label.textColor = .secondaryLabel
    label.text = message
    contentStack.addArrangedSubview(label)
  }

  @objc private func shareTapped() {
    Task {
      do {
        let data: Data
        if let loadedData {
          data = loadedData
        } else if let url = artifact.url ?? artifact.contentUrl {
          data = try await client.artifactData(url)
          loadedData = data
        } else {
          return
        }

        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeFilename())
        try data.write(to: fileURL, options: .atomic)
        let vc = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        present(vc, animated: true)
      } catch {
        showError(error)
      }
    }
  }

  private func safeFilename() -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._- "))
    let cleaned = artifact.title.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" }
    let name = String(cleaned).trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? "artifact" : name
  }
}

private func kindLabel(_ kind: String) -> String {
  kind
    .replacingOccurrences(of: "_", with: " ")
    .replacingOccurrences(of: "-", with: " ")
    .split(separator: " ")
    .map { $0.capitalized }
    .joined(separator: " ")
}
