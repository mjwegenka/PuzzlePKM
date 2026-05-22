import SwiftUI
import SwiftyDropbox

@main
struct PuzzlePKMMobileApp: App {

    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var dropboxService = DropboxService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(dropboxService)
        }
    }
}

// MARK: - AppDelegate

final class AppDelegate: NSObject, UIApplicationDelegate {

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let appKey = UserDefaults.standard.string(forKey: "dropboxAppKey") ?? ""
        if !appKey.isEmpty {
            DropboxClientsManager.setupWithAppKey(appKey)
        }
        return true
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        // The DropboxService instance handles the OAuth redirect URL.
        // The notification triggers the service to update its state.
        NotificationCenter.default.post(
            name: .dropboxOAuthRedirect,
            object: url
        )
        return true
    }
}

extension Notification.Name {
    static let dropboxOAuthRedirect = Notification.Name("DropboxOAuthRedirect")
}
