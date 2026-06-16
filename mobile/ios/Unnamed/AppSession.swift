import Foundation
import Security

final class AppSession {
  static let shared = AppSession()

  private enum Keys {
    static let serverURL = "server_url"
    static let authToken = "auth_token"
  }

  private let defaults: UserDefaults
  private let keychain: KeychainStore

  init(defaults: UserDefaults = .standard, keychain: KeychainStore = KeychainStore()) {
    self.defaults = defaults
    self.keychain = keychain
  }

  var serverURL: URL? {
    guard let raw = defaults.string(forKey: Keys.serverURL) else { return nil }
    return URL(string: raw)
  }

  var token: String? {
    keychain.string(forKey: Keys.authToken)
  }

  func setServerURL(_ url: URL) {
    defaults.set(url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forKey: Keys.serverURL)
  }

  func setToken(_ token: String) {
    keychain.set(token, forKey: Keys.authToken)
  }

  func clearToken() {
    keychain.delete(Keys.authToken)
  }

  func reset() {
    defaults.removeObject(forKey: Keys.serverURL)
    clearToken()
  }
}

struct KeychainStore {
  private let service = "com.unnamed.app"

  func string(forKey key: String) -> String? {
    var query = baseQuery(forKey: key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func set(_ value: String, forKey key: String) {
    let data = Data(value.utf8)
    var query = baseQuery(forKey: key)
    let attributes = [kSecValueData as String: data]

    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      query[kSecValueData as String] = data
      SecItemAdd(query as CFDictionary, nil)
    }
  }

  func delete(_ key: String) {
    SecItemDelete(baseQuery(forKey: key) as CFDictionary)
  }

  private func baseQuery(forKey key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key
    ]
  }
}
