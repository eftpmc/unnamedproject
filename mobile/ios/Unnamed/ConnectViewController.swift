import UIKit

final class ConnectViewController: UIViewController {
  var onNeedsLogin: (() -> Void)?
  var onConnectedWithoutAuth: (() -> Void)?

  private let session: AppSession
  private lazy var client = APIClient(session: session)
  private let urlField = FormTextField(placeholder: "http://192.168.1.x:3000", keyboardType: .URL)
  private let connectButton = PrimaryButton(type: .system)
  private let activity = UIActivityIndicatorView(style: .medium)

  init(session: AppSession) {
    self.session = session
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Connect"
    view.backgroundColor = AppTheme.canvas

    urlField.text = session.serverURL?.absoluteString ?? "http://"
    urlField.textContentType = .URL
    urlField.returnKeyType = .go
    urlField.addTarget(self, action: #selector(connectTapped), for: .primaryActionTriggered)

    connectButton.configuration?.title = "Connect"
    connectButton.configuration?.image = UIImage(systemName: "arrow.right")
    connectButton.configuration?.imagePlacement = .trailing
    connectButton.configuration?.imagePadding = 8
    connectButton.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)

    let icon = centeredIcon(systemName: "server.rack")

    let titleLabel = UILabel()
    titleLabel.text = "Connect your workspace"
    titleLabel.font = UIFont.preferredFont(forTextStyle: .largeTitle)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0

    let helpLabel = UILabel()
    helpLabel.text = "Enter the Unnamed server address from your Mac. QR connect and saved hosts can land here next."
    helpLabel.font = UIFont.preferredFont(forTextStyle: .body)
    helpLabel.adjustsFontForContentSizeCategory = true
    helpLabel.textColor = .secondaryLabel
    helpLabel.numberOfLines = 0
    helpLabel.textAlignment = .center

    let card = SurfaceView()
    let formStack = UIStackView(arrangedSubviews: [urlField, connectButton, activity])
    formStack.axis = .vertical
    formStack.alignment = .fill
    formStack.spacing = 12
    formStack.isLayoutMarginsRelativeArrangement = true
    formStack.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)
    card.addSubview(formStack)
    formStack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      formStack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      formStack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      formStack.topAnchor.constraint(equalTo: card.topAnchor),
      formStack.bottomAnchor.constraint(equalTo: card.bottomAnchor)
    ])

    let stack = UIStackView(arrangedSubviews: [icon, titleLabel, helpLabel, card])
    stack.axis = .vertical
    stack.alignment = .fill
    stack.spacing = 16
    stack.setCustomSpacing(26, after: helpLabel)

    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
  }

  private func centeredIcon(systemName: String) -> UIView {
    let wrapper = UIView()
    let icon = IconBadgeView(systemName: systemName, tintColor: AppTheme.accent)
    wrapper.addSubview(icon)
    icon.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      icon.centerXAnchor.constraint(equalTo: wrapper.centerXAnchor),
      icon.topAnchor.constraint(equalTo: wrapper.topAnchor),
      icon.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor)
    ])
    return wrapper
  }

  @objc private func connectTapped() {
    guard let raw = urlField.text?.trimmingCharacters(in: .whitespacesAndNewlines),
          let url = URL(string: raw), url.scheme != nil else {
      showError(APIError.invalidURL)
      return
    }

    setLoading(true)
    Task {
      do {
        session.setServerURL(url)
        if session.token == nil {
          onNeedsLogin?()
        } else {
          _ = try await client.me()
          onConnectedWithoutAuth?()
        }
      } catch APIError.unauthorized {
        onNeedsLogin?()
      } catch {
        showError(error)
      }
      setLoading(false)
    }
  }

  private func setLoading(_ loading: Bool) {
    connectButton.isEnabled = !loading
    loading ? activity.startAnimating() : activity.stopAnimating()
  }
}
