import SwiftUI

/// Root tab container for the PuzzlePKM mobile app.
struct ContentView: View {

    @EnvironmentObject private var dropboxService: DropboxService

    var body: some View {
        TabView {
            DailyNoteView()
                .tabItem {
                    Label("Daily Note", systemImage: "note.text")
                }

            HabitView()
                .tabItem {
                    Label("Habits", systemImage: "checkmark.circle")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
        .onReceive(
            NotificationCenter.default.publisher(for: .dropboxOAuthRedirect)
        ) { note in
            if let url = note.object as? URL {
                _ = dropboxService.handleRedirectURL(url)
            }
        }
    }
}
