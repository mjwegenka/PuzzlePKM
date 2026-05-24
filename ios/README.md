# PuzzlePKM Mobile – iOS Companion App

A write-only iPhone app for creating daily notes and habits that sync with the PuzzlePKM desktop app via Dropbox.

## Overview

The app writes entries to a `mobile-inbox/` sub-folder inside your configured Dropbox sync root:

| Object type | Path written |
|-------------|-------------|
| Daily note  | `{rootFolder}/mobile-inbox/daily-notes/YYYY-MM-DD.md` |
| Habit       | `{rootFolder}/mobile-inbox/habits/{date}-{tag}-{shortId}.md` |

The next time you run `puzzlepkm sync` on your desktop, PuzzlePKM processes the mobile inbox:

- **Daily notes** – content is *appended* to any existing note for the same date. If no note exists, a new one is created.
- **Habits** – each file is imported as a new habit entry.

Mobile inbox files are deleted from Dropbox after successful processing.

## Requirements

- Xcode 15 or later
- iOS 17 or later deployment target
- A Dropbox account with the Dropbox iOS app installed (for folder sync)
- A Dropbox Platform app key (see [Dropbox App Console](https://www.dropbox.com/developers/apps))

## Xcode Setup

### 1. Clone the repository

```bash
git clone https://github.com/mjwegenka/puzzlepkm.git
cd puzzlepkm/ios
```

### 2. Create a new Xcode project

1. Open Xcode and choose **File → New → Project**.
2. Select **iOS → App**.
3. Set the product name to **PuzzlePKMMobile**, bundle identifier to something like `com.yourname.puzzlepkm.mobile`, and interface to **SwiftUI**.
4. Save the project inside `puzzlepkm/ios/`.

### 3. Add the Swift Package

1. In Xcode, choose **File → Add Package Dependencies…**
2. Paste the SwiftyDropbox package URL:
   ```
   https://github.com/dropbox/SwiftyDropbox.git
   ```
3. Select version **9.1.0** or later.
4. Add the **SwiftyDropbox** library to your app target.

### 4. Add the source files

Drag all `.swift` files from `ios/Sources/PuzzlePKMMobile/` into your Xcode project target (uncheck *Copy items if needed* if they are already inside the project directory):

- `App.swift`
- `ContentView.swift`
- `DailyNoteView.swift`
- `HabitView.swift`
- `SettingsView.swift`
- `DropboxService.swift`
- `Models.swift`

Delete the placeholder `ContentView.swift` that Xcode generated for you before adding these files.

### 5. Configure the URL scheme

The Dropbox OAuth flow redirects back to your app using a custom URL scheme derived from your App Key.

1. In Xcode, select your app target → **Info** tab → **URL Types**.
2. Add a new URL type with the scheme `db-<YOUR_APP_KEY>` (replace `<YOUR_APP_KEY>` with the key you created in the Dropbox App Console).

### 6. Set the entry point

Make sure the `@main` attribute in `App.swift` is the only entry point (delete any `@main` from the Xcode-generated file).

### 7. Build and run

Build and run the app on a simulator or device. On first launch:

1. Open the **Settings** tab.
2. Enter your **Dropbox App Key**.
3. Set the **Sync Root Folder** (must match the value configured in PuzzlePKM on your desktop, e.g. `/PuzzlePKM`).
4. Tap **Connect to Dropbox** and complete the OAuth flow.

## Creating a Dropbox App Key

1. Go to [https://www.dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) and sign in.
2. Click **Create app**.
3. Choose **Scoped access** → **Full Dropbox** (or **App folder** if you prefer a sandboxed location; in that case, update the `rootFolder` accordingly).
4. Give your app a name.
5. Under **Permissions**, enable **files.content.write** and **files.content.read**.
6. Under **OAuth 2**, add a redirect URI: `db-<YOUR_APP_KEY>://2/token`.
7. Copy the **App key** and paste it into the app's Settings screen.

## File Format Reference

### Mobile daily-note file (`mobile-inbox/daily-notes/YYYY-MM-DD.md`)

```markdown
---
source: "mobile"
date: "2024-01-15"
writtenAt: "2024-01-15T14:30:00Z"
---

Content written from mobile...
```

### Mobile habit file (`mobile-inbox/habits/{date}-{tag}-{shortId}.md`)

```markdown
---
source: "mobile"
date: "2024-01-15"
text: "Read for 30 minutes"
tag: "Reading"
status: "accomplished"
writtenAt: "2024-01-15T14:30:00Z"
---
```

## Desktop Sync

After writing notes or habits from the mobile app, run the sync on your desktop:

```bash
puzzlepkm sync
```

Or enable the background daemon:

```bash
puzzlepkm sync --watch
```

The sync output includes appended mobile notes in the **updated** count and imported mobile habits in the **imported** count.

## Architecture Notes

- The app is write-only by design; it does not read existing notes from Dropbox.
- Each daily note save overwrites any previous mobile draft for the same date (only the most recent draft is sent to desktop).
- Each habit save creates a new uniquely-named file, so multiple habits per day are supported.
- The Dropbox SDK handles authentication tokens in the iOS Keychain automatically.
- See `IMPLEMENTATION_DECISIONS.md` (DEC-55) in the repository root for the full design decision record.
