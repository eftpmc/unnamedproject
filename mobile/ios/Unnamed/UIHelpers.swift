import UIKit

extension Notification.Name {
  static let approvalBadgeCleared = Notification.Name("ApprovalBadgeCleared")
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

  func pinToSuperviewEdges() {
    guard let superview else { return }
    translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      leadingAnchor.constraint(equalTo: superview.leadingAnchor),
      trailingAnchor.constraint(equalTo: superview.trailingAnchor),
      topAnchor.constraint(equalTo: superview.topAnchor),
      bottomAnchor.constraint(equalTo: superview.bottomAnchor)
    ])
  }
}

enum ChatTimeGroup: Int {
  case today, yesterday, last7, older
  var label: String {
    switch self {
    case .today: return "Today"
    case .yesterday: return "Yesterday"
    case .last7: return "Previous 7 Days"
    case .older: return "Older"
    }
  }
}

/// Groups chats into Today / Yesterday / Previous 7 Days / Older, newest-first
/// within each group. Empty groups are omitted. Uses updatedAt, falling back to createdAt.
func groupChatsByTime(_ chats: [ChatSession], now: Date = Date()) -> [(group: ChatTimeGroup, chats: [ChatSession])] {
  let cal = Calendar.current
  func ts(_ c: ChatSession) -> Int { c.updatedAt ?? c.createdAt ?? 0 }
  func bucket(_ c: ChatSession) -> ChatTimeGroup {
    let d = Date(timeIntervalSince1970: TimeInterval(ts(c)))
    if cal.isDateInToday(d) { return .today }
    if cal.isDateInYesterday(d) { return .yesterday }
    if let days = cal.dateComponents([.day], from: d, to: now).day, days < 7 { return .last7 }
    return .older
  }
  var map: [ChatTimeGroup: [ChatSession]] = [:]
  for c in chats { map[bucket(c), default: []].append(c) }
  return [ChatTimeGroup.today, .yesterday, .last7, .older].compactMap { g in
    guard let items = map[g], !items.isEmpty else { return nil }
    return (g, items.sorted { ts($0) > ts($1) })
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
    configuration?.background.backgroundColor = .secondarySystemBackground
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
    backgroundColor = .secondarySystemBackground
    layer.borderColor = UIColor.separator.cgColor
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
      layer.borderColor = UIColor.separator.cgColor
    }
  }
}

final class SurfaceView: UIView {
  init() {
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerRadius = 18
    layer.cornerCurve = .continuous
    layer.borderColor = UIColor.separator.cgColor
    layer.borderWidth = 1
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      layer.borderColor = UIColor.separator.cgColor
    }
  }
}

final class BrandMarkView: UIView {
  init(size: CGFloat = 56) {
    super.init(frame: .zero)
    backgroundColor = .tintColor
    layer.cornerRadius = size * 0.32
    layer.cornerCurve = .continuous

    let label = UILabel()
    label.text = "u"
    label.textColor = .white
    label.font = .systemFont(ofSize: size * 0.5, weight: .semibold)
    label.textAlignment = .center

    addSubview(label)
    label.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: size),
      heightAnchor.constraint(equalToConstant: size),
      label.centerXAnchor.constraint(equalTo: centerXAnchor),
      label.centerYAnchor.constraint(equalTo: centerYAnchor)
    ])
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }
}

final class IconBadgeView: UIView {
  init(systemName: String, tintColor: UIColor = .tintColor) {
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

// MARK: - Message Segments

enum MessageSegment {
  case text(String)
  case code(String)
}

func parseMessageSegments(_ raw: String) -> [MessageSegment] {
  var segments: [MessageSegment] = []
  var textBuffer = ""
  var codeBuffer = ""
  var inFence = false

  for line in raw.components(separatedBy: "\n") {
    if line.hasPrefix("```") {
      if inFence {
        if !codeBuffer.isEmpty { segments.append(.code(codeBuffer)) }
        codeBuffer = ""
        inFence = false
      } else {
        if !textBuffer.isEmpty { segments.append(.text(textBuffer)); textBuffer = "" }
        inFence = true
      }
    } else if inFence {
      codeBuffer += (codeBuffer.isEmpty ? "" : "\n") + line
    } else {
      textBuffer += (textBuffer.isEmpty ? "" : "\n") + line
    }
  }

  if inFence && !codeBuffer.isEmpty { segments.append(.code(codeBuffer)) }
  else if !textBuffer.isEmpty { segments.append(.text(textBuffer)) }

  return segments
}

// MARK: - Markdown Rendering

func markdownAttributedString(_ raw: String, baseFont: UIFont, textColor: UIColor) -> NSAttributedString {
  let output = NSMutableAttributedString()
  var codeBuffer = ""
  var inFence = false
  let monoFont = UIFont.monospacedSystemFont(ofSize: baseFont.pointSize * 0.88, weight: .regular)
  let codeBg = UIColor.label.withAlphaComponent(0.08)
  let lines = raw.components(separatedBy: "\n")

  for (i, line) in lines.enumerated() {
    if line.hasPrefix("```") {
      if inFence {
        output.append(NSAttributedString(string: codeBuffer, attributes: [
          .font: monoFont, .foregroundColor: textColor, .backgroundColor: codeBg,
        ]))
        codeBuffer = ""
        inFence = false
      } else {
        inFence = true
      }
    } else if inFence {
      codeBuffer += (codeBuffer.isEmpty ? "" : "\n") + line
    } else {
      var lineText = line
      var lineFont = baseFont
      if line.hasPrefix("### ")      { lineText = String(line.dropFirst(4)); lineFont = .systemFont(ofSize: baseFont.pointSize + 1, weight: .semibold) }
      else if line.hasPrefix("## ") { lineText = String(line.dropFirst(3)); lineFont = .systemFont(ofSize: baseFont.pointSize + 2, weight: .bold) }
      else if line.hasPrefix("# ")  { lineText = String(line.dropFirst(2)); lineFont = .systemFont(ofSize: baseFont.pointSize + 4, weight: .bold) }
      output.append(applyInlineMarkdown(lineText, font: lineFont, color: textColor, codeBg: codeBg))
      if i < lines.count - 1 {
        output.append(NSAttributedString(string: "\n", attributes: [.font: baseFont, .foregroundColor: textColor]))
      }
    }
  }
  if inFence && !codeBuffer.isEmpty {
    output.append(applyInlineMarkdown(codeBuffer, font: baseFont, color: textColor, codeBg: codeBg))
  }
  return output
}

func applyInlineMarkdown(_ text: String, font: UIFont, color: UIColor, codeBg: UIColor) -> NSAttributedString {
  let boldFont = UIFont.boldSystemFont(ofSize: font.pointSize)
  let italicDesc = font.fontDescriptor.withSymbolicTraits(.traitItalic) ?? font.fontDescriptor
  let italicFont = UIFont(descriptor: italicDesc, size: font.pointSize)
  let monoFont = UIFont.monospacedSystemFont(ofSize: font.pointSize * 0.9, weight: .regular)

  struct Span {
    let fullRange: Range<String.Index>
    let contentRange: Range<String.Index>
    let extraAttrs: [NSAttributedString.Key: Any]
  }

  let rules: [(String, [NSAttributedString.Key: Any])] = [
    ("`([^`\n]+)`",           [.font: monoFont, .backgroundColor: codeBg]),
    ("\\*\\*([^*\n]+)\\*\\*", [.font: boldFont]),
    ("__([^\n]+?)__",          [.font: boldFont]),
    ("\\*([^*\n]+)\\*",        [.font: italicFont]),
    ("_([^_\n]+)_",            [.font: italicFont]),
  ]

  var spans: [Span] = []
  for (pattern, attrs) in rules {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
    let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
    for m in matches {
      guard let full = Range(m.range, in: text) else { continue }
      let content: Range<String.Index>
      if m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: text) { content = r }
      else { content = full }
      spans.append(Span(fullRange: full, contentRange: content, extraAttrs: attrs))
    }
  }

  spans.sort { $0.fullRange.lowerBound < $1.fullRange.lowerBound }
  var filtered: [Span] = []
  var lastEnd = text.startIndex
  for span in spans where span.fullRange.lowerBound >= lastEnd {
    filtered.append(span)
    lastEnd = span.fullRange.upperBound
  }

  let result = NSMutableAttributedString()
  var cursor = text.startIndex
  let base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]

  for span in filtered {
    if cursor < span.fullRange.lowerBound {
      result.append(NSAttributedString(string: String(text[cursor..<span.fullRange.lowerBound]), attributes: base))
    }
    var spanAttrs = base
    for (k, v) in span.extraAttrs { spanAttrs[k] = v }
    result.append(NSAttributedString(string: String(text[span.contentRange]), attributes: spanAttrs))
    cursor = span.fullRange.upperBound
  }
  if cursor < text.endIndex {
    result.append(NSAttributedString(string: String(text[cursor...]), attributes: base))
  }
  return result
}

// MARK: - Skeleton Loading

final class SkeletonCell: UITableViewCell {
  static let reuseID = "SkeletonCell"

  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none

    let skeletonColor = UIColor.secondarySystemFill

    let icon = UIView()
    icon.backgroundColor = skeletonColor
    icon.layer.cornerRadius = 16
    icon.layer.cornerCurve = .continuous

    let title = UIView()
    title.backgroundColor = skeletonColor
    title.layer.cornerRadius = 4

    let subtitle = UIView()
    subtitle.backgroundColor = skeletonColor
    subtitle.layer.cornerRadius = 4

    let textStack = UIStackView(arrangedSubviews: [title, subtitle])
    textStack.axis = .vertical
    textStack.spacing = 8

    let row = UIStackView(arrangedSubviews: [icon, textStack])
    row.axis = .horizontal
    row.spacing = 12
    row.alignment = .center
    row.isLayoutMarginsRelativeArrangement = true
    row.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)

    contentView.addSubview(row)
    row.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      row.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      row.topAnchor.constraint(equalTo: contentView.topAnchor),
      row.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
      icon.widthAnchor.constraint(equalToConstant: 32),
      icon.heightAnchor.constraint(equalToConstant: 32),
      title.heightAnchor.constraint(equalToConstant: 14),
      subtitle.heightAnchor.constraint(equalToConstant: 11),
      subtitle.widthAnchor.constraint(equalTo: textStack.widthAnchor, multiplier: 0.55),
    ])

    let anim = CABasicAnimation(keyPath: "opacity")
    anim.fromValue = 0.4
    anim.toValue = 1.0
    anim.duration = 0.85
    anim.autoreverses = true
    anim.repeatCount = .infinity
    contentView.layer.add(anim, forKey: "shimmer")
  }

  required init?(coder: NSCoder) { fatalError() }
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
