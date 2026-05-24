# PuzzlePKM Desktop UI - Design & Implementation

## Overview

The PuzzlePKM desktop interface is a comprehensive knowledge management GUI built with React, Material-UI, and TypeScript. It provides three main functional areas: Calendar (for daily notes), File Browser (for projects and reference materials), and an Object Editor with @ mention support for creating and editing content.

## UI Architecture

### Layout Structure

The app uses a **sidebar + content** layout pattern:

```
┌─────────────────┬──────────────────────────────────────┐
│                 │                                      │
│  Navigation     │        Main Content Area             │
│  Sidebar        │  (Responsive to current section)    │
│  240px fixed    │                                      │
│                 │                                      │
│  - Calendar     ├──────────────────────────────────────┤
│  - Files        │  Calendar    │  Notes List  │ Editor │
│  - New Note     │  (25%)       │  (25%)       │(50%)   │
│  - Tags         │              │              │        │
│  - Settings     │              │              │        │
└─────────────────┴──────────────────────────────────────┘
```

### Color Scheme (Dark Mode)

All colors follow the UI Design Contract:
- Background: `#0b1828`
- Surface: `#0e2038`
- Border: `#1c3558`
- Text: `#e4f0fb`
- Muted: `#7dbad6`
- Primary: `#1a8ab5`

## Core Components

### 1. NavigationSidebar (`components/NavigationSidebar.tsx`)

Persistent left sidebar with navigation items:
- **Calendar**: View and manage daily notes by date
- **Files**: Browse projects and reference materials
- **New Note**: Create new topic notes
- **Tags**: View and manage tags (coming soon)
- **Settings**: Configuration (coming soon)

**Features:**
- Active section highlighting with left border indicator
- Permanent drawer (always visible on desktop)
- Responsive sidebar width (240px)

### 2. CalendarView (`components/CalendarView.tsx`)

Interactive calendar for managing daily notes by date:
- Month navigation (prev/next buttons)
- "Today" quick jump button
- Day highlighting:
  - **Today**: Light blue background with border
  - **Selected**: Filled primary color
  - **Other**: Outlined style
- Grid layout with 7 columns (Sun-Sat)
- Click handlers for date selection

**Props:**
```typescript
interface CalendarViewProps {
  onDateSelect: (date: string) => void;  // Format: YYYY-MM-DD
  selectedDate?: string;                 // Currently selected date
}
```

### 3. FileExplorer (`components/FileExplorer.tsx`)

Directory browser for sync-backed content:
- Lists projects and reference materials as folders
- Navigation via folder double-click or name click
- Back button to parent directory
- Folder/file icons for visual differentiation
- Mock data structure (will connect to CLI sync listings)

**Features:**
- Hierarchical folder browsing
- File/folder type indicators
- Search placeholder (future enhancement)

### 4. ObjectList (`components/ObjectList.tsx`)

Scrollable list of notes/objects with search:

**Display:**
- Title (top priority)
- Date (subtitle)
- Preview text (truncated)
- Tags (first 2 visible, "+N" for overflow)

**Functionality:**
- Real-time search filtering
- Click selection highlights
- Organized list view with dividers

**Props:**
```typescript
interface ObjectListProps {
  items: ObjectListItem[];
  type: string;
  onSelect: (id: string) => void;
  selectedId?: string;
}
```

### 5. ObjectEditor (`components/ObjectEditor.tsx`)

**Core editor component** with layout guarantee:
- **Top section**: Title & Date (always visible)
- **Middle section**: Content area (supports @ mentions)
- **Bottom section**: Tags (always at bottom)

#### Layout Structure:

```
┌─ TITLE / NAME (at top) ─────────────┐
│  [Title/Name TextField]             │
│  [Date Field]                       │
├──────────────────────────────────── │
│                                      │
│  [Content TextArea]                  │
│  (Type @ to mention objects)         │
│  (Mention popup appears here)        │
│                                      │
├─ TAGS (at bottom) ──────────────── │
│  [+] [Tag1] [Tag2] [Tag3]           │
├──────────────────────────────────── │
│  [Cancel] [Save]                     │
└──────────────────────────────────────┘
```

#### @ Mention System:

**Trigger:** Typing `@` character in content textarea

**Search:** Extracts query after `@` and filters:
- Daily notes by date
- Topic notes by title
- Projects by name
- Reference materials by name

**Format:** `[@Title](id)` in markdown

**Mention Popup** positions absolutely below textarea with:
- Maximum 8 suggestions visible
- Scrollable list if more exist
- Click to insert mention

#### Form Fields by Type:

| Type | Fields |
|------|--------|
| **daily-note** | Date, Content, Tags |
| **topic-note** | Title, Content, Tags |
| **project** | Name, Start Date, End Date, Tags |
| **ref-material** | Name, Author (optional), Tags |
| **habit** | Text (as content), Date, Tags |

### 6. MentionPopup (`components/MentionPopup.tsx`)

Floating search results for @ mentions:
- Positioned absolutely (top, left from parent textarea)
- Horizontal overflow hidden
- Shows object title + type + date (if applicable)
- Hover highlight (`rgba(26,138,181,0.2)`)
- Click to insert and close

---

## Component Interaction Flow

### Calendar View Flow:

```
User clicks date in calendar
  ↓
CalendarView.onDateSelect(date)
  ↓
App.handleDateSelect(date)
  ↓
- Sets selectedDate
- Finds matching daily note from list
- Sets selectedObject
  ↓
ObjectEditor displays note
```

### @ Mention Flow:

```
User types @ in textarea
  ↓
ObjectEditor.handleContentChange()
  ↓
- Detects @ character
- Extracts query string
- Calculates cursor position
  ↓
MentionPopup renders with filtered options
  ↓
User clicks option
  ↓
ObjectEditor.handleMentionSelect()
  ↓
- Replaces @query with [@Title](id)
- Closes mention popup
  ↓
Content updated with embedded link
```

---

## Styling Guidelines

### Typography
- **Heading**: `variant="h6"` with `fontWeight: 600`
- **Body**: `variant="body2"` for standard text
- **Caption**: `variant="caption"` for metadata (dates, tags)
- **Code**: Monospace for commands/IDs

### Colors
- Primary actions: `#1a8ab5`
- Borders: `#1c3558`
- Muted text: `#7dbad6`
- Foreground: `#e4f0fb`

### Spacing
- Large gaps: `spacing={2}` (16px)
- Medium gaps: `spacing={1}` (8px)
- Compact gaps: `spacing={0.5}` (4px)

### Border Radius
- Controls: `0.9rem`
- Cards: `0.75rem`
- Modals: `1rem`

---

## Service Layer (`lib/cliService.ts`)

Async functions that invoke the Tauri CLI bridge:
- `runPuzzlePKMCli(args)` - Execute CLI command
- `listObjects(type)` - Get list of objects
- `getObject(type, id)` - Fetch single object
- `updateObject(type, id, data)` - Update object
- `deleteObject(type, id)` - Delete object
- `searchObjects(query)` - Full-text search

---

## Future Enhancements

1. **Tags View** - Aggregate view of all tags with object counts
2. **Search/Filter** - Full-text search across all objects
3. **Sync Status** - Visual indicator for sync progress
4. **Keyboard Shortcuts** - Cmd+K for command palette
5. **Split Pane** - Side-by-side comparison of notes
6. **Markdown Preview** - Live preview while editing
7. **Export** - Export notes as PDF/HTML
8. **Themes** - Light mode support

---

## Implementation Status

✅ **Completed:**
- Sidebar navigation
- Calendar view with date selection
- File explorer structure
- Object editor with layout guarantee
- @ mention detection and filtering
- Mention popup with positioning
- Tag management in editor
- CLI service layer

🔄 **In Progress:**
- Connect CLI to load real data
- Full sync integration
- Sync daemon indicators

⏳ **Planned:**
- Tags view
- Settings screen
- Advanced search
- Keyboard nav
