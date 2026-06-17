import UIKit

enum AppTheme {
  static let canvas = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0.07, green: 0.07, blue: 0.06, alpha: 1)
      : UIColor(red: 0.965, green: 0.955, blue: 0.935, alpha: 1)
  }

  static let surface = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0.115, green: 0.11, blue: 0.10, alpha: 1)
      : UIColor(red: 1.0, green: 0.992, blue: 0.975, alpha: 1)
  }

  static let secondarySurface = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0.15, green: 0.145, blue: 0.13, alpha: 1)
      : UIColor(red: 0.935, green: 0.922, blue: 0.89, alpha: 1)
  }

  static let border = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(white: 1.0, alpha: 0.10)
      : UIColor(red: 0.74, green: 0.70, blue: 0.63, alpha: 0.42)
  }

  static let primary = UIColor { traits in
    traits.userInterfaceStyle == .dark
      ? UIColor(red: 0.91, green: 0.88, blue: 0.80, alpha: 1)
      : UIColor(red: 0.13, green: 0.12, blue: 0.10, alpha: 1)
  }

  static let primaryText = UIColor { traits in
    traits.userInterfaceStyle == .dark ? .black : .white
  }

  static let accent = UIColor(red: 0.16, green: 0.38, blue: 0.78, alpha: 1)
  static let warning = UIColor(red: 0.82, green: 0.47, blue: 0.12, alpha: 1)
}

func relativeTime(from epoch: Int) -> String {
  let diff = max(0, Int(-Date(timeIntervalSince1970: TimeInterval(epoch)).timeIntervalSinceNow))
  if diff < 60 { return "Just now" }
  if diff < 3600 { return "\(diff / 60)m ago" }
  if diff < 86400 { return "\(diff / 3600)h ago" }
  if diff < 604800 { return "\(diff / 86400)d ago" }
  let fmt = DateFormatter()
  fmt.dateStyle = .short
  fmt.timeStyle = .none
  return fmt.string(from: Date(timeIntervalSince1970: TimeInterval(epoch)))
}

extension UIView {
  func pinToSuperviewMargins() {
    guard let superview else { return }
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: superview.layoutMarginsGuide.leadingAnchor),
      trailingAnchor.constraint(equalTo: superview.layoutMarginsGuide.trailingAnchor),
      topAnchor.constraint(equalTo: superview.layoutMarginsGuide.topAnchor),
      bottomAnchor.constraint(equalTo: superview.layoutMarginsGuide.bottomAnchor)
    ])
  }
}

extension UIViewController {
  func showError(_ error: Error) {
    let alert = UIAlertController(
      title: "Something went wrong",
      message: (error as? LocalizedError)?.errorDescription ?? error.localizedDescription,
      preferredStyle: .alert
    )
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    present(alert, animated: true)
  }

  func showNotice(title: String, message: String) {
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    present(alert, animated: true)
  }
}

final class PrimaryButton: UIButton {
  override init(frame: CGRect) {
    super.init(frame: frame)
    configuration = .filled()
    configuration?.cornerStyle = .medium
    configuration?.baseBackgroundColor = AppTheme.primary
    configuration?.baseForegroundColor = AppTheme.primaryText
    configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
    titleLabel?.font = UIFont.preferredFont(forTextStyle: .headline)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

final class SecondaryButton: UIButton {
  override init(frame: CGRect) {
    super.init(frame: frame)
    configuration = .plain()
    configuration?.cornerStyle = .medium
    configuration?.baseForegroundColor = .label
    configuration?.background.backgroundColor = AppTheme.secondarySurface
    configuration?.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14)
    titleLabel?.font = UIFont.preferredFont(forTextStyle: .callout)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

final class FormTextField: UITextField {
  init(placeholder: String, keyboardType: UIKeyboardType = .default, secure: Bool = false) {
    super.init(frame: .zero)
    self.placeholder = placeholder
    self.keyboardType = keyboardType
    self.isSecureTextEntry = secure
    borderStyle = .roundedRect
    autocorrectionType = .no
    autocapitalizationType = .none
    backgroundColor = AppTheme.surface
    layer.borderColor = AppTheme.border.cgColor
    layer.borderWidth = 1
    layer.cornerRadius = 12
    layer.cornerCurve = .continuous
    heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      layer.borderColor = AppTheme.border.cgColor
    }
  }
}

final class SurfaceView: UIView {
  init() {
    super.init(frame: .zero)
    backgroundColor = AppTheme.surface
    layer.cornerRadius = 18
    layer.cornerCurve = .continuous
    layer.borderColor = AppTheme.border.cgColor
    layer.borderWidth = 1
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      layer.borderColor = AppTheme.border.cgColor
    }
  }
}

final class IconBadgeView: UIView {
  init(systemName: String, tintColor: UIColor = AppTheme.accent) {
    super.init(frame: .zero)
    backgroundColor = tintColor.withAlphaComponent(0.12)
    layer.cornerRadius = 10
    layer.cornerCurve = .continuous

    let imageView = UIImageView(image: UIImage(systemName: systemName))
    imageView.tintColor = tintColor
    imageView.contentMode = .scaleAspectFit

    addSubview(imageView)
    imageView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: 36),
      heightAnchor.constraint(equalToConstant: 36),
      imageView.centerXAnchor.constraint(equalTo: centerXAnchor),
      imageView.centerYAnchor.constraint(equalTo: centerYAnchor),
      imageView.widthAnchor.constraint(equalToConstant: 17),
      imageView.heightAnchor.constraint(equalToConstant: 17)
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

final class ComposerTextView: UITextView {
  private let placeholderLabel = UILabel()
  var placeholder: String = "" {
    didSet { placeholderLabel.text = placeholder }
  }

  override var text: String! {
    didSet { updatePlaceholder() }
  }

  override init(frame: CGRect, textContainer: NSTextContainer?) {
    super.init(frame: frame, textContainer: textContainer)
    backgroundColor = .clear
    font = UIFont.preferredFont(forTextStyle: .body)
    adjustsFontForContentSizeCategory = true
    isScrollEnabled = false
    textContainerInset = UIEdgeInsets(top: 10, left: 2, bottom: 10, right: 2)

    placeholderLabel.font = UIFont.preferredFont(forTextStyle: .body)
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.textColor = .tertiaryLabel
    placeholderLabel.numberOfLines = 0
    addSubview(placeholderLabel)
    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      placeholderLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 7),
      placeholderLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
      placeholderLabel.topAnchor.constraint(equalTo: topAnchor, constant: 10)
    ])

    NotificationCenter.default.addObserver(self, selector: #selector(textChanged), name: UITextView.textDidChangeNotification, object: self)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func textChanged() {
    updatePlaceholder()
  }

  private func updatePlaceholder() {
    placeholderLabel.isHidden = !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}
