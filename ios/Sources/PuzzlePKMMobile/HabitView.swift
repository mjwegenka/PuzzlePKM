import SwiftUI

/// Write-only view for creating habit entries that are sent to the mobile inbox.
///
/// The user enters a short description (≤ 255 characters), an optional tag, a
/// status, and a date. On save the habit is uploaded to
/// `{rootFolder}/mobile-inbox/habits/{date}-{tag}-{shortId}.md` via Dropbox.
/// The next time `puzzlepkm sync` runs on the desktop, the habit is imported as
/// a new entry (DEC-55).
struct HabitView: View {

    @EnvironmentObject private var dropboxService: DropboxService

    @State private var entry = HabitEntry()
    @State private var isSaving = false
    @State private var showSuccess = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Date") {
                    DatePicker(
                        "Habit Date",
                        selection: $entry.date,
                        displayedComponents: .date
                    )
                    .labelsHidden()
                }

                Section("Habit") {
                    TextField("What did you do? (max 255 chars)", text: $entry.text)
                        .onChange(of: entry.text) { _, newValue in
                            if newValue.count > 255 {
                                entry.text = String(newValue.prefix(255))
                            }
                        }
                }

                Section("Tag") {
                    TextField("Tag (e.g. Exercise, Reading)", text: $entry.tag)
                        .autocorrectionDisabled()
                }

                Section("Status") {
                    Picker("Status", selection: $entry.status) {
                        ForEach(HabitStatus.allCases) { status in
                            Text(status.displayName).tag(status)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("Habit")
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
                Text("Your habit has been sent to the mobile inbox. It will appear in PuzzlePKM the next time you sync on the desktop.")
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
        entry.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !dropboxService.isAuthenticated
    }

    private var errorIsPresented: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )
    }

    private func save() {
        let trimmed = entry.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSaving = true
        Task {
            do {
                try await dropboxService.writeHabit(entry)
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
        entry = HabitEntry()
    }
}
