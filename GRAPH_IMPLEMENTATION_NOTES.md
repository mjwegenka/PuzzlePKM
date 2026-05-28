# Force-Directed Graph Implementation

## Overview

The graph view has been completely redesigned from a static circular layout to a **force-directed simulation** using `react-force-graph`. This enables meaningful relationship visualization with scriptures, tags, and scripture book grouping.

## Key Features

### 1. Force-Directed Layout
- **Physics-based positioning**: Nodes repel each other and edges pull related nodes together
- **Dynamic clustering**: Related concepts naturally cluster spatially
- **Smooth interactions**: Drag to pan, scroll to zoom, click to focus
- Libraries: `react-force-graph` (2D rendering backed by `force-graph` and d3-force)

### 2. Scriptures with Book Grouping
- **Scripture nodes**: Each scripture reference appears as a node (colored red by default)
- **Virtual book nodes**: Grouping labels (e.g., "Romans", "John") organize scriptures visually without being interactive
- **Automatic clustering**: Scriptures pull together under their book, and book clusters are spatially grouped
- **Book name extraction**: Parses references like "Romans 3:16" → groups under "Romans" node

### 3. Optional Tag Nodes
- **Toggle on/off**: Tags are available via the object-type filter (default: OFF to reduce visual clutter)
- **Hub-and-spoke pattern**: When enabled, tags become central nodes with edges to tagged notes
- **Thematic clustering**: Makes tag-based organization spatial and discoverable
- **Tag color**: Gold (#faad14) distinguishes tags from content nodes

### 4. Relationship Edges
The graph now shows:
- **Note-to-note links** (direct references between notes)
- **Note-to-tag edges** (which tags apply to each note)
- **Scripture-to-book edges** (implicit grouping via parent book node)
- Can be extended later for other relationships (shared authors, project membership, etc.)

### 5. Interactive Node Focus
- **Single click**: Focuses a node (highlights it, shows its full label and details in the bottom panel)
- **Double click**: Opens the focused node for editing (calls `onOpenNode` callback)
- **Special handling**:
  - Scripture-book nodes: Cannot be opened (virtual/label-only)
  - Tag nodes: Can be focused but not opened (use tag filter instead)
  - All other types: Can be focused and opened

## Technical Implementation

### Data Flow

```
listMetaBundle() → Graph data assembly:
  ├── Note nodes (topic-note, daily-note, habit, project, ref-material)
  ├── Scripture nodes (colored, extracted from references)
  ├── Virtual book nodes (no clickable content; visual grouping only)
  └── Optional tag nodes (togglable)

Edge collection:
  ├── Note-to-note (from note.links)
  ├── Note-to-tag (from note.tags lookup)
  └── Scripture-to-book (from scripture.reference book extraction)

Filtering:
  ├── By object type (toggle visibility per type)
  ├── By tag filters (inherited from app)
  ├── By search query (node label substring match)
  └── Book nodes auto-hide if no scripture children are visible
```

### Component Structure

**`GraphPage.tsx`**:
- Top toolbar: object-type filter, search input, visible node count
- Graph canvas (ForceGraph2D component with canvas rendering)
- Details panel (focused node label, type, tag count)
- Supports lazy mounting (only initializes when user navigates to graph tab)

**`objectColors.ts`** additions:
- Added `'tag'` → gold (#faad14)
- Added `'scripture-book'` → red (#f5222d, same as scripture)

**Prop refinement**:
- `GraphPageProps.onOpenNode` now type-restricted to only openable types:
  - `'topic-note' | 'daily-note' | 'habit' | 'project' | 'ref-material' | 'scripture'`
  - Excludes`'tag'` and `'scripture-book'` (not openable)

## Performance Notes

- **First load**: Graph data bundled via single `listMetaBundle()` call (7.44x faster than per-type list calls)
- **Force simulation**: `warmupTicks=20` (initial settling), `cooldownTicks=0` (continuous)
- **Rendering**: Canvas-based (efficient for many nodes)
- **Filtering**: Memoized to prevent unnecessary recalculations

## Example Visualization Behavior

**Default state** (Tags OFF):
- Notes cluster by relationships
- Scriptures cluster by book
- High-connections notes become visual hubs
- Scripture books hang off nearby notes that cite them

**With Tags ON**:
- Tag nodes appear as gold hubs
- Heavily-tagged notes pull toward their tags
- Creates visible theme organization
- More nodes = potentially busy, but reveals tag structure

## Future Enhancements

1. **Edge metadata display**: Hover over edges to show link count or relationship type
2. **Node sizing by degree**: Size ∝ number of connections (visual importance)
3. **Custom forces**: Separate forces for different edge types (tag edges stiffer than note links)
4. **Author clustering**: Add author nodes (if relevant), group ref-materials by author
5. **Temporal edges**: Connect related daily notes chronologically
6. **Export/share**: Generate graph snapshots for external sharing

## Build & Runtime

- **Dependencies added**: `react-force-graph` (~123 packages, ~26 MB to node_modules)
- **Bundle impact**: ~6.4 MB gzipped for entire app (warning: >500kB chunk; can optimize later with code-splitting)
- **TypeScript**: Full type support via `react-force-graph` type definitions
- **Compatibility**: Tested on macOS with Tauri dev environment; should work on all platforms

## Testing the Graph

1. Launch app with `npm run tauri:dev`
2. Navigate to "Graph" tab
3. Default: See notes and scriptures organized by force simulation
4. Click object-type filter → toggle "Tags" ON to see tag hubs
5. Search for a note title to filter view
6. Click a node to focus it and see details
7. Double-click to open in editor
8. Drag to pan, scroll to zoom

