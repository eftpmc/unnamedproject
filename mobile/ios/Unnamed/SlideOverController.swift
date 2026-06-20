// mobile/ios/Unnamed/SlideOverController.swift
import UIKit

final class SlideOverController: UIViewController {
  let sideWidthRatio: CGFloat = 0.84

  /// Invoked right before the side drawer animates open, so callers can
  /// refresh the sidebar's contents (e.g. newly created chats, active dots)
  /// instead of relying on the one-time load done in viewDidLoad.
  var onWillOpenSide: (() -> Void)?

  private var mainVC: UIViewController
  private let sideVC: UIViewController
  private let scrim = UIControl()
  private let sideContainer = UIView()
  private var sideLeading: NSLayoutConstraint!
  private var isOpen = false

  init(main: UIViewController, side: UIViewController) {
    self.mainVC = main
    self.sideVC = side
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError() }

  private var sideWidth: CGFloat { view.bounds.width * sideWidthRatio }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = AppTheme.canvas

    addChild(mainVC)
    mainVC.view.frame = view.bounds
    mainVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(mainVC.view)
    mainVC.didMove(toParent: self)

    scrim.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    scrim.alpha = 0
    scrim.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrim)
    NSLayoutConstraint.activate([
      scrim.topAnchor.constraint(equalTo: view.topAnchor),
      scrim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scrim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    scrim.addTarget(self, action: #selector(scrimTapped), for: .touchUpInside)

    sideContainer.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(sideContainer)
    sideLeading = sideContainer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: -1)
    NSLayoutConstraint.activate([
      sideContainer.topAnchor.constraint(equalTo: view.topAnchor),
      sideContainer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      sideContainer.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: sideWidthRatio),
      sideLeading,
    ])

    addChild(sideVC)
    sideVC.view.frame = sideContainer.bounds
    sideVC.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    sideContainer.addSubview(sideVC.view)
    sideVC.didMove(toParent: self)

    let edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgePan(_:)))
    edgePan.edges = .left
    view.addGestureRecognizer(edgePan)

    let drag = UIPanGestureRecognizer(target: self, action: #selector(handleDrag(_:)))
    sideContainer.addGestureRecognizer(drag)
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    if !isOpen { sideLeading.constant = -sideWidth - 1 }
  }

  func setMain(_ vc: UIViewController) {
    let old = mainVC
    old.willMove(toParent: nil)
    addChild(vc)
    vc.view.frame = view.bounds
    vc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.insertSubview(vc.view, belowSubview: scrim)
    vc.didMove(toParent: self)
    old.view.removeFromSuperview()
    old.removeFromParent()
    mainVC = vc
  }

  func openSide(animated: Bool = true) {
    onWillOpenSide?()
    isOpen = true
    sideLeading.constant = 0
    UIView.animate(withDuration: animated ? 0.28 : 0, delay: 0, options: .curveEaseOut) {
      self.scrim.alpha = 1
      self.view.layoutIfNeeded()
    }
  }

  func closeSide(animated: Bool = true) {
    isOpen = false
    sideLeading.constant = -sideWidth - 1
    UIView.animate(withDuration: animated ? 0.25 : 0, delay: 0, options: .curveEaseIn) {
      self.scrim.alpha = 0
      self.view.layoutIfNeeded()
    }
  }

  @objc private func scrimTapped() { closeSide() }

  @objc private func handleEdgePan(_ g: UIScreenEdgePanGestureRecognizer) {
    let t = g.translation(in: view).x
    switch g.state {
    case .changed:
      sideLeading.constant = min(0, -sideWidth + t)
      scrim.alpha = max(0, min(1, (sideWidth + sideLeading.constant) / sideWidth))
    case .ended, .cancelled:
      (sideWidth + sideLeading.constant) > sideWidth * 0.4 ? openSide() : closeSide()
    default: break
    }
  }

  @objc private func handleDrag(_ g: UIPanGestureRecognizer) {
    let t = g.translation(in: view).x
    switch g.state {
    case .changed:
      sideLeading.constant = min(0, t)
      scrim.alpha = max(0, min(1, (sideWidth + sideLeading.constant) / sideWidth))
    case .ended, .cancelled:
      let v = g.velocity(in: view).x
      (sideLeading.constant > -sideWidth * 0.5 && v > -500) ? openSide() : closeSide()
    default: break
    }
  }
}
