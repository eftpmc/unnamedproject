import UIKit

final class LoginViewController: UIViewController {
  var onSignedIn: (() -> Void)?
  var onChangeServer: (() -> Void)?

  private let session: AppSession
  private lazy var client = APIClient(session: session)
  private let emailField = FormTextField(placeholder: "Email", keyboardType: .emailAddress)
  private let passwordField = FormTextField(placeholder: "Password", secure: true)
  private let signInButton = PrimaryButton(type: .system)
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
    title = "Sign In"
    view.backgroundColor = AppTheme.canvas
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Server", style: .plain, target: self, action: #selector(changeServerTapped))

    passwordField.returnKeyType = .go
    passwordField.addTarget(self, action: #selector(signInTapped), for: .primaryActionTriggered)

    signInButton.configuration?.title = "Sign In"
    signInButton.configuration?.image = UIImage(systemName: "arrow.right")
    signInButton.configuration?.imagePlacement = .trailing
    signInButton.configuration?.imagePadding = 8
    signInButton.addTarget(self, action: #selector(signInTapped), for: .touchUpInside)

    let brandMark = centeredBrandMark()

    let titleLabel = UILabel()
    titleLabel.text = "Welcome back"
    titleLabel.font = UIFont.preferredFont(forTextStyle: .largeTitle)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0

    let helpLabel = UILabel()
    helpLabel.text = "Sign in to keep chats, projects, and approvals tied to this server."
    helpLabel.font = UIFont.preferredFont(forTextStyle: .body)
    helpLabel.adjustsFontForContentSizeCategory = true
    helpLabel.textColor = .secondaryLabel
    helpLabel.numberOfLines = 0
    helpLabel.textAlignment = .center

    let serverLabel = UILabel()
    serverLabel.text = session.serverURL?.absoluteString
    serverLabel.font = UIFont.preferredFont(forTextStyle: .footnote)
    serverLabel.adjustsFontForContentSizeCategory = true
    serverLabel.textColor = .secondaryLabel
    serverLabel.textAlignment = .center
    serverLabel.numberOfLines = 2

    let card = SurfaceView()
    let formStack = UIStackView(arrangedSubviews: [serverLabel, emailField, passwordField, signInButton, activity])
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

    let stack = UIStackView(arrangedSubviews: [brandMark, titleLabel, helpLabel, card])
    stack.axis = .vertical
    stack.alignment = .fill
    stack.spacing = 16
    stack.setCustomSpacing(20, after: brandMark)
    stack.setCustomSpacing(26, after: helpLabel)

    view.addSubview(stack)
    stack.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
  }

  private func centeredBrandMark() -> UIView {
    let wrapper = UIView()
    let mark = BrandMarkView()
    wrapper.addSubview(mark)
    mark.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      mark.centerXAnchor.constraint(equalTo: wrapper.centerXAnchor),
      mark.topAnchor.constraint(equalTo: wrapper.topAnchor),
      mark.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor)
    ])
    return wrapper
  }

  @objc private func signInTapped() {
    let email = emailField.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let password = passwordField.text ?? ""
    guard !email.isEmpty, !password.isEmpty else {
      showError(APIError.server(status: 400, message: "Enter your email and password."))
      return
    }

    setLoading(true)
    Task {
      do {
        let response = try await client.login(email: email, password: password)
        session.setToken(response.token)
        onSignedIn?()
      } catch {
        showError(error)
      }
      setLoading(false)
    }
  }

  @objc private func changeServerTapped() {
    onChangeServer?()
  }

  private func setLoading(_ loading: Bool) {
    signInButton.isEnabled = !loading
    loading ? activity.startAnimating() : activity.stopAnimating()
  }
}
