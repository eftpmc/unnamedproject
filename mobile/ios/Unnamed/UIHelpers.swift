import UIKit
import Speech
import AVFoundation

extension Notification.Name {
  static let approvalBadgeCleared = Notification.Name("ApprovalBadgeCleared")
}

/// Bridges the web app's design tokens (web/src/index.css) into UIKit dynamic
/// colors, so native screens read as the same product rather than stock iOS.
/// Approximated from the web app's oklch tokens — not pixel-exact conversions.
enum AppPalette {
  private static func dynamic(light: UIColor, dark: UIColor) -> UIColor {
    UIColor { $0.userInterfaceStyle == .dark ? dark : light }
  }

  /// Desaturated indigo accent (web --primary), replaces system blue.
  static let accent = dynamic(
    light: UIColor(red: 0.36, green: 0.43, blue: 0.74, alpha: 1),
    dark: UIColor(red: 0.58, green: 0.64, blue: 0.88, alpha: 1)
  )
  static let accentForeground = dynamic(
    light: .white,
    dark: UIColor(red: 0.10, green: 0.11, blue: 0.15, alpha: 1)
  )

  /// Neutral chip surface (web --muted) — used for the user message bubble
  /// and tool icon badges instead of a colored/tinted fill.
  static let muted = dynamic(
    light: UIColor(red: 0.961, green: 0.965, blue: 0.973, alpha: 1),
    dark: UIColor(red: 0.137, green: 0.149, blue: 0.192, alpha: 1)
  )

  /// Slightly softer body text for assistant messages (web --fg-soft).
  static let foregroundSoft = dynamic(
    light: UIColor(red: 0.31, green: 0.32, blue: 0.36, alpha: 1),
    dark: UIColor(red: 0.79, green: 0.80, blue: 0.83, alpha: 1)
  )

  /// Hairline border (web --border-soft).
  static let borderSoft = dynamic(
    light: UIColor(red: 0.925, green: 0.929, blue: 0.941, alpha: 1),
    dark: UIColor.white.withAlphaComponent(0.045)
  )

  /// Composer card surface (web --card).
  static let card = dynamic(
    light: UIColor.white,
    dark: UIColor(red: 0.149, green: 0.157, blue: 0.184, alpha: 1)
  )

  /// Composer card border (web --input — more opaque than --border-soft in dark mode).
  static let inputBorder = dynamic(
    light: UIColor(red: 0.886, green: 0.890, blue: 0.902, alpha: 1),
    dark: UIColor.white.withAlphaComponent(0.18)
  )

  /// Code blocks always render GitHub-dark, in both appearances (web behavior).
  static let codeBackground = UIColor(red: 0x0d / 255.0, green: 0x11 / 255.0, blue: 0x17 / 255.0, alpha: 1)
  static let codeForeground = UIColor(red: 0xc9 / 255.0, green: 0xd1 / 255.0, blue: 0xd9 / 255.0, alpha: 1)

  static let success = dynamic(
    light: UIColor(red: 0.30, green: 0.62, blue: 0.45, alpha: 1),
    dark: UIColor(red: 0.52, green: 0.78, blue: 0.62, alpha: 1)
  )
  static let warning = dynamic(
    light: UIColor(red: 0.72, green: 0.55, blue: 0.18, alpha: 1),
    dark: UIColor(red: 0.85, green: 0.70, blue: 0.35, alpha: 1)
  )
  static let destructive = dynamic(
    light: UIColor(red: 0.75, green: 0.32, blue: 0.30, alpha: 1),
    dark: UIColor(red: 0.85, green: 0.50, blue: 0.48, alpha: 1)
  )
}

/// Strips emoji from assistant text so chat reads like an agent transcript
/// rather than a texting app, mirroring the web app's stripEmoji behavior.
func stripEmoji(_ text: String) -> String {
  // `isEmoji` (Unicode "Emoji" property) mirrors the web app's
  // \p{Extended_Pictographic} regex more closely than `isEmojiPresentation`
  // alone — it also catches symbols like ✓ or ➡ that default to text
  // presentation but still render as emoji glyphs in most fonts. It also
  // covers ASCII digits/'#'/'*' (used in keycap sequences like 1️⃣), so those
  // are explicitly excluded to avoid eating plain numbers. 0x200D is ZWJ
  // (joins emoji sequences like family/profession emoji into one grapheme).
  let stripped = String(text.unicodeScalars.filter { scalar in
    if scalar.value == 0xFE0F || scalar.value == 0x200D { return false }
    if scalar.isASCII { return true }
    return !scalar.properties.isEmoji
  })
  return stripped.replacingOccurrences(of: "[ \t]{2,}", with: " ", options: .regularExpression)
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

extension UIFont {
  func withWeight(_ weight: UIFont.Weight) -> UIFont {
    let descriptor = fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: weight]])
    return UIFont(descriptor: descriptor, size: pointSize)
  }
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
  /// Removes the standard 1px hairline under the nav bar for screens whose
  /// content doesn't butt up against it (e.g. centered onboarding forms).
  func hideNavBarHairline() {
    let appearance = UINavigationBarAppearance()
    appearance.configureWithTransparentBackground()
    navigationItem.standardAppearance = appearance
    navigationItem.scrollEdgeAppearance = appearance
    navigationItem.compactAppearance = appearance
  }

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
    autocorrectionType = .no
    autocapitalizationType = .none
    backgroundColor = .secondarySystemBackground
    layer.cornerRadius = 12
    layer.cornerCurve = .continuous
    let inset = UIView(frame: CGRect(x: 0, y: 0, width: 14, height: 1))
    leftView = inset
    leftViewMode = .always
    rightView = inset
    rightViewMode = .always
    heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
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

/// Line-aware markdown rendering for a text segment (code fences are already
/// split out upstream by `parseMessageSegments`, so this only has to handle
/// headers, bullet lists, horizontal rules, and inline emphasis/code).
func markdownAttributedString(_ raw: String, baseFont: UIFont, textColor: UIColor, codeBg: UIColor, lineSpacing: CGFloat = 0) -> NSAttributedString {
  let output = NSMutableAttributedString()
  let lines = raw.components(separatedBy: "\n")

  func isRule(_ line: String) -> Bool {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard trimmed.count >= 3 else { return false }
    return trimmed.allSatisfy { $0 == "-" } || trimmed.allSatisfy { $0 == "*" } || trimmed.allSatisfy { $0 == "_" }
  }

  var renderedAny = false
  for line in lines {
    if isRule(line) { continue }

    var lineText = line
    var lineFont = baseFont
    var bulletPrefix = ""
    if line.hasPrefix("### ")      { lineText = String(line.dropFirst(4)); lineFont = .systemFont(ofSize: baseFont.pointSize + 1, weight: .semibold) }
    else if line.hasPrefix("## ")  { lineText = String(line.dropFirst(3)); lineFont = .systemFont(ofSize: baseFont.pointSize + 2, weight: .bold) }
    else if line.hasPrefix("# ")   { lineText = String(line.dropFirst(2)); lineFont = .systemFont(ofSize: baseFont.pointSize + 4, weight: .bold) }
    else if line.hasPrefix("- ") || line.hasPrefix("* ") { lineText = String(line.dropFirst(2)); bulletPrefix = "•  " }

    if renderedAny {
      output.append(NSAttributedString(string: "\n", attributes: [.font: baseFont, .foregroundColor: textColor]))
    }
    if !bulletPrefix.isEmpty {
      output.append(NSAttributedString(string: bulletPrefix, attributes: [.font: lineFont, .foregroundColor: textColor]))
    }
    output.append(applyInlineMarkdown(lineText, font: lineFont, color: textColor, codeBg: codeBg, lineSpacing: lineSpacing))
    renderedAny = true
  }
  return output
}

func applyInlineMarkdown(_ text: String, font: UIFont, color: UIColor, codeBg: UIColor, lineSpacing: CGFloat = 0) -> NSAttributedString {
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
  var base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
  if lineSpacing > 0 {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = lineSpacing
    base[.paragraphStyle] = paragraph
  }

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

/// Wraps SFSpeechRecognizer + AVAudioEngine for live dictation — the iOS
/// equivalent of the web app's browser SpeechRecognition API. One session at
/// a time; call `stop()` before `start()`-ing again.
final class SpeechDictationController {
  enum SpeechDictationError: LocalizedError {
    case notAuthorized
    case unavailable

    var errorDescription: String? {
      switch self {
      case .notAuthorized: return "Speech recognition permission was denied."
      case .unavailable: return "Speech recognition is not available right now."
      }
    }
  }

  var onTranscript: ((String) -> Void)?
  var onError: ((Error) -> Void)?
  var onEnd: (() -> Void)?

  private let recognizer = SFSpeechRecognizer(locale: .current)
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  func start() {
    SFSpeechRecognizer.requestAuthorization { [weak self] status in
      DispatchQueue.main.async {
        guard status == .authorized else {
          self?.onError?(SpeechDictationError.notAuthorized)
          return
        }
        self?.beginSession()
      }
    }
  }

  private func beginSession() {
    guard let recognizer, recognizer.isAvailable else {
      onError?(SpeechDictationError.unavailable)
      return
    }

    let audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      onError?(error)
      return
    }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }
    self.request = request

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.removeTap(onBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
      request.append(buffer)
    }

    audioEngine.prepare()
    do {
      try audioEngine.start()
    } catch {
      onError?(error)
      return
    }

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      if let result {
        self?.onTranscript?(result.bestTranscription.formattedString)
      }
      if error != nil || result?.isFinal == true {
        self?.stop()
      }
    }
  }

  func stop() {
    guard audioEngine.isRunning else { return }
    audioEngine.stop()
    audioEngine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.cancel()
    task = nil
    request = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    onEnd?()
  }
}
