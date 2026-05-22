import Foundation

// MARK: - Daily Note

/// A daily-note entry that the user writes in the mobile app.
struct DailyNoteEntry {
    /// Calendar date for the note (defaults to today).
    var date: Date = Date()
    /// Markdown body content written by the user.
    var content: String = ""
}

// MARK: - Habit

/// A habit entry that the user writes in the mobile app.
struct HabitEntry {
    /// Calendar date for the habit (defaults to today).
    var date: Date = Date()
    /// Short description of the habit (max 255 characters, matching DEC-45).
    var text: String = ""
    /// Single identity tag for the habit (matching DEC-45 single-tag rule).
    var tag: String = ""
    /// Lifecycle status of the habit.
    var status: HabitStatus = .accomplished
}

/// Lifecycle status for a habit, matching the `planned`/`accomplished` enum in DEC-45.
enum HabitStatus: String, CaseIterable, Identifiable {
    case planned = "planned"
    case accomplished = "accomplished"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .planned:      return "Planned"
        case .accomplished: return "Accomplished"
        }
    }
}
