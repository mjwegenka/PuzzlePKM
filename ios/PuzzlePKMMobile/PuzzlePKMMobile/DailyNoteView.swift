import SwiftUI

/// Write-only view for creating daily note entries that are sent to the mobile inbox.
///
/// The user picks a date (defaults to today) and writes Markdown content. On save
/// the content is uploaded to `{rootFolder}/mobile-inbox/daily-notes/YYYY-MM-DD.md`
/// via Dropbox. The next time `puzzlepkm sync` runs on the desktop, the content is
/// appended to any existing daily note for that date or a new note is created.
struct DailyNoteView: View {

    @EnvironmentObject private var dropboxService: DropboxService

    @State private var entry = DailyNoteEntry()
    @State private var isSaving = false
    @State private var showSuccess = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Date") {
                    DatePicker(
                        "Note Date",
                        selection: $entry.date,
                        displayedComponents: .date
                    )
                    .labelsHidden()
                }

                Section("Content") {
                    TextEditor(text: $entry.content)
                        .frame(minHeight: 220)
                        .overlay(alignment: .topLeading) {
                            if entry.content.isEmpty {
                                Text("Write your daily note here…")
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 8)
                                    .padding(.leading, 4)
                                    .allowsHitTesting(false)
                            }
                        }
                }
            }
            .navigationTitle("Daily Note")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { save() }
                            .disabled(isSavingDisabled)
                    }
                }
            }
            .alert("Saved!", isPresented: $showSuccess) {
                Button("OK") { resetForm() }
            } message: {
                Text("Your daily note has been sent to the mobile inbox. It will appear in PuzzlePKM the next time you sync on the desktop.")
            }
            .alert("Error", isPresented: errorIsPresented) {
                Button("OK") { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: Private

    private var isSavingDisabled: Bool {
        isSaving ||
        entry.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !dropboxService.isAuthenticated
    }

    private var errorIsPresented: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )
    }

    private func save() {
        let trimmed = entry.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSaving = true
        Task {
            do {
                try await dropboxService.writeDailyNote(entry)
                await MainActor.run {
                    isSaving = false
                    showSuccess = true
                }
            } catch {
                await MainActor.run {
                    isSaving = false
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    private func resetForm() {
        entry = DailyNoteEntry()
    }
}
