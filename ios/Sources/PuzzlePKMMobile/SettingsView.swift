import SwiftUI

/// Settings view for configuring the Dropbox connection and sync root folder.
struct SettingsView: View {

    @EnvironmentObject private var dropboxService: DropboxService

    @AppStorage("dropboxAppKey") private var appKey: String = ""
    @AppStorage("rootFolder")    private var rootFolder: String = "/Dropith"

    @State private var pendingAppKey: String = ""
    @State private var pendingRootFolder: String = ""
    @State private var showDisconnectConfirm = false
    @State private var showRelaunchNotice = false

    var body: some View {
        NavigationStack {
            Form {
                dropboxSection
                syncFolderSection
                aboutSection
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("Save") { saveSettings() }
                }
            }
            .confirmationDialog(
                "Disconnect from Dropbox?",
                isPresented: $showDisconnectConfirm,
                titleVisibility: .visible
            ) {
                Button("Disconnect", role: .destructive) {
                    dropboxService.disconnect()
                }
                Button("Cancel", role: .cancel) {}
            }
            .alert("App Key Updated", isPresented: $showRelaunchNotice) {
                Button("OK") {}
            } message: {
                Text("The new Dropbox App Key will take effect the next time the app launches. Please restart the app to apply it.")
            }
        }
        .onAppear { loadPendingValues() }
    }

    // MARK: Sections

    private var dropboxSection: some View {
        Section {
            if dropboxService.isAuthenticated {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                    Text("Connected to Dropbox")
                }
                Button("Disconnect", role: .destructive) {
                    showDisconnectConfirm = true
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Dropbox App Key", text: $pendingAppKey)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    Text("Create an app at dropbox.com/developers to get your App Key.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Button("Connect to Dropbox") {
                    saveSettings()
                    dropboxService.authenticate()
                }
                .disabled(pendingAppKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } header: {
            Text("Dropbox")
        }
    }

    private var syncFolderSection: some View {
        Section {
            TextField("/Dropith", text: $pendingRootFolder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            Text("Must match the root folder configured in PuzzlePKM on your desktop (e.g. /Dropith).")
                .font(.caption)
                .foregroundStyle(.secondary)
        } header: {
            Text("Sync Root Folder")
        }
    }

    private var aboutSection: some View {
        let effective = pendingRootFolder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? rootFolder
            : pendingRootFolder
        return Section {
            LabeledContent("Mobile Inbox", value: "\(effective)/mobile-inbox/")
            Text(
                "Daily notes and habits you write here are saved to the mobile inbox folder inside your Dropbox sync folder. " +
                "Run `puzzlepkm sync` on your desktop to merge them: daily notes are appended to any existing note for the same date; habits are imported as new entries."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
        } header: {
            Text("About")
        }
    }

    // MARK: Private

    private func loadPendingValues() {
        pendingAppKey    = appKey
        pendingRootFolder = rootFolder
    }

    private func saveSettings() {
        let newAppKey     = pendingAppKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let newRootFolder = pendingRootFolder.trimmingCharacters(in: .whitespacesAndNewlines)

        let appKeyChanged = newAppKey != appKey
        if !newAppKey.isEmpty {
            appKey = newAppKey
        }
        if !newRootFolder.isEmpty {
            rootFolder = newRootFolder
        }

        if appKeyChanged && !newAppKey.isEmpty {
            showRelaunchNotice = true
        }
    }
}
