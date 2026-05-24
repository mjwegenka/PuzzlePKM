import Foundation
import Combine
import SwiftyDropbox
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Errors

enum DropboxServiceError: LocalizedError {
    case notAuthenticated
    case encodingFailed
    case uploadFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "Not authenticated with Dropbox. Please connect in Settings."
        case .encodingFailed:
            return "Failed to encode content for upload."
        case .uploadFailed(let message):
            return "Upload failed: \(message)"
        }
    }
}

// MARK: - DropboxService

/// Handles Dropbox OAuth authentication and file uploads for the mobile inbox.
///
/// The iOS app writes daily notes and habits to a `mobile-inbox/` sub-folder
/// inside the configured sync root folder (default `/PuzzlePKM`). When the
/// desktop runs `puzzlepkm sync`, it processes these files: daily notes are
/// appended to any existing note for the same date, and habits are imported as
/// new entries. See DEC-55 for the full specification.
@MainActor
final class DropboxService: ObservableObject {

    // MARK: Published state

    @Published var isAuthenticated: Bool = false
    @Published var errorMessage: String?

    // MARK: Private helpers

    private let localDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    // MARK: Computed properties

    /// The configured sync root folder (e.g. `/PuzzlePKM`).
    var rootFolder: String {
        (UserDefaults.standard.string(forKey: "rootFolder") ?? "/PuzzlePKM")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Initialization

    init() {
        let appKey = UserDefaults.standard.string(forKey: "dropboxAppKey") ?? ""
        if !appKey.isEmpty {
            DropboxClientsManager.setupWithAppKey(appKey)
        }
        isAuthenticated = DropboxClientsManager.authorizedClient != nil
    }

    // MARK: Authentication

    /// Begin the Dropbox OAuth flow using ASWebAuthenticationSession.
    func authenticate() {
        let scopeRequest = ScopeRequest(
            scopeType: .user,
            scopes: ["files.content.write", "files.content.read"],
            includeGrantedScopes: false
        )
#if canImport(UIKit)
        guard
            let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
            let rootVC = windowScene.windows.first?.rootViewController
        else { return }

        DropboxClientsManager.authorizeFromControllerV2(
            UIApplication.shared,
            controller: rootVC,
            loadingStatusDelegate: nil,
            openURL: { UIApplication.shared.open($0) },
            scopeRequest: scopeRequest
        )
#else
        errorMessage = "Dropbox authentication requires a UIKit app environment."
#endif
    }

    /// Handle the OAuth redirect URL from the app delegate / scene delegate.
    func handleRedirectURL(_ url: URL) -> Bool {
        var didHandle = false
        let oauthCompletion: DropboxOAuthCompletion = { [weak self] result in
            guard let self else { return }
            if case .success = result {
                Task { @MainActor in
                    self.isAuthenticated = true
                }
            }
        }
        didHandle = DropboxClientsManager.handleRedirectURL(
            url,
            completion: oauthCompletion
        )
        return didHandle
    }

    /// Unlink the current Dropbox account.
    func disconnect() {
        DropboxClientsManager.unlinkClients()
        isAuthenticated = false
    }

    // MARK: Write operations

    /// Upload a daily-note entry to the mobile inbox so the desktop sync can process it.
    ///
    /// Writes to: `{rootFolder}/mobile-inbox/daily-notes/YYYY-MM-DD.md`
    ///
    /// Format:
    /// ```
    /// ---
    /// source: "mobile"
    /// date: "YYYY-MM-DD"
    /// writtenAt: "<ISO-8601 timestamp>"
    /// ---
    ///
    /// <user content>
    /// ```
    func writeDailyNote(_ entry: DailyNoteEntry) async throws {
        guard let client = DropboxClientsManager.authorizedClient else {
            throw DropboxServiceError.notAuthenticated
        }

        let dateStr = localDateFormatter.string(from: entry.date)
        let writtenAt = isoFormatter.string(from: Date())
        let path = "\(rootFolder)/mobile-inbox/daily-notes/\(dateStr).md"
        let body = entry.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let fileContent = """
        ---
        source: "mobile"
        date: "\(dateStr)"
        writtenAt: "\(writtenAt)"
        ---

        \(body)
        """

        guard let data = fileContent.data(using: .utf8) else {
            throw DropboxServiceError.encodingFailed
        }

        // Overwrite any previous mobile draft for the same date.
        try await upload(client: client, path: path, data: data, mode: .overwrite)
    }

    /// Upload a habit entry to the mobile inbox so the desktop sync can import it.
    ///
    /// Writes to: `{rootFolder}/mobile-inbox/habits/{date}-{tag}-{shortId}.md`
    ///
    /// Format:
    /// ```
    /// ---
    /// source: "mobile"
    /// date: "YYYY-MM-DD"
    /// text: "<habit text>"
    /// tag: "<tag>"
    /// status: "accomplished"|"planned"
    /// writtenAt: "<ISO-8601 timestamp>"
    /// ---
    /// ```
    func writeHabit(_ entry: HabitEntry) async throws {
        guard let client = DropboxClientsManager.authorizedClient else {
            throw DropboxServiceError.notAuthenticated
        }

        let dateStr = localDateFormatter.string(from: entry.date)
        let writtenAt = isoFormatter.string(from: Date())
        let shortId = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(6).lowercased())
        let safeTag = entry.tag.isEmpty
            ? ""
            : entry.tag.lowercased()
                .components(separatedBy: .whitespacesAndNewlines).joined(separator: "-")
                .components(separatedBy: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-")).inverted).joined()
        let filename = "\(dateStr)-\(safeTag)-\(shortId).md"
        let path = "\(rootFolder)/mobile-inbox/habits/\(filename)"
        let text = String(entry.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(255))
        let fileContent = """
        ---
        source: "mobile"
        date: "\(dateStr)"
        text: \(jsonEncode(text))
        tag: \(jsonEncode(entry.tag.trimmingCharacters(in: .whitespacesAndNewlines)))
        status: "\(entry.status.rawValue)"
        writtenAt: "\(writtenAt)"
        ---
        """

        guard let data = fileContent.data(using: .utf8) else {
            throw DropboxServiceError.encodingFailed
        }

        // Each habit is a new file (`.add` mode) to preserve multiple habits per day.
        try await upload(client: client, path: path, data: data, mode: .add)
    }

    // MARK: Private helpers

    private func upload(
        client: DropboxClient,
        path: String,
        data: Data,
        mode: Files.WriteMode
    ) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            client.files.upload(path: path, mode: mode, input: data)
                .response { _, error in
                    if let error {
                        continuation.resume(throwing: DropboxServiceError.uploadFailed(error.description))
                    } else {
                        continuation.resume()
                    }
                }
        }
    }

    /// JSON-encode a string value so it can be safely embedded in YAML front matter.
    private func jsonEncode(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: value),
            let encoded = String(data: data, encoding: .utf8)
        else {
            return "\"\(value)\""
        }
        return encoded
    }
}
