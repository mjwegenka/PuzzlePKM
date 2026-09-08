import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Button, cn } from 'aslan-ui';
import React, { useCallback, useEffect, useState, type ReactNode } from 'react'
import NavigationSidebar from './components/app-shell/NavigationSidebar'
import TitleBarHandler from './components/app-shell/TitleBarHandler'
import CalendarPage from './components/calendar/CalendarPage'
import LibraryPage from './components/notes/LibraryPage'
import GraphPage from './components/graph/GraphPage'
import SettingsPage from './components/app-shell/SettingsPage'

import { cycleTagFilterState, type TagFilterState } from './lib/tagFilters'
import { useUnsavedChangesStore } from './lib/unsavedChangesStore'



function GlobalCloseConfirmDialog() {
  const { showCloseConfirm, setShowCloseConfirm } = useUnsavedChangesStore()
  const [closeError, setCloseError] = useState<string | null>(null)

  // This dialog is the only way out of a close blocked by onCloseRequested, so a
  // failure here leaves the window unclosable. Render the reason instead of
  // logging it: release builds ship without devtools, so a console-only error is
  // invisible — which is how a missing core:window:allow-destroy capability once
  // presented as the red X simply not working.
  const handleQuitWithoutSaving = async () => {
    setCloseError(null)
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().destroy()
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : String(error))
    }
  }

  // Cancel sets the store directly rather than going through onOpenChange, so
  // clearing on dismissal would miss it and the next open would show a stale
  // error. Clear on open instead, which covers every dismissal path.
  useEffect(() => {
    if (showCloseConfirm) setCloseError(null)
  }, [showCloseConfirm])

  return (
    <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
      <DialogContent className="max-w-sm">
        <DialogTitle>Unsaved Changes</DialogTitle>
        <DialogDescription>
          You have unsaved changes. Are you sure you want to quit without saving?
        </DialogDescription>
        {closeError && (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-sm font-semibold text-red-600">Couldn&apos;t close the window</p>
            <p className="mt-1 text-xs wrap-break-word text-red-500">{closeError}</p>
          </div>
        )}
        <DialogFooter className="mt-4 flex justify-end space-x-2">
          <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleQuitWithoutSaving}>
            {closeError ? 'Try again' : 'Quit without saving'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Simple error boundary for graph to prevent white screen
class GraphErrorBoundary extends React.Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[var(--color-surface-elevated)]">
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
            <p className="text-sm font-semibold text-red-600">Graph view unavailable</p>
            <p className="mt-2 text-xs text-red-500">
              {this.state.error?.message || 'An error occurred while loading the graph.'}
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

type Section = 'calendar' | 'library' | 'graph'
type FileObjType = 'project' | 'ref-material'
type NotesObjType = 'topic-note' | 'daily-note' | 'habit'
/** Habits are created inside a daily note's habit panel, not from the Library. */
type CreatableNotesObjType = 'topic-note' | 'daily-note'
type MetaObjType = 'scripture' | 'scripture-chapter' | 'tag'
type LibraryObjectType = NotesObjType | FileObjType | MetaObjType
type PinnedObjType = NotesObjType | FileObjType

interface PinnedTarget {
  id: string
  type: PinnedObjType
}

interface LibraryPendingSelection {
  id: string
  type: LibraryObjectType
  nonce: number
}

interface LibraryPendingCreate {
  type: CreatableNotesObjType
  date?: string
  nonce: number
}

function resolveSectionAlias(section: string): Section {
  if (section === 'scripture' || section === 'tags' || section === 'files') return 'library'
  if (section === 'calendar' || section === 'library' || section === 'graph') {
    return section
  }
  return 'library'
}

export default function App() {
  const isSettingsWindow = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('settings') === 'true'
  const [sidebarSection, setSidebarSection] = useState<Section>('library')
  const [mountedSections, setMountedSections] = useState<Record<Section, boolean>>({
    library: true,
    calendar: false,
    graph: false,
  })
  const [libraryPendingSelection, setLibraryPendingSelection] = useState<LibraryPendingSelection | null>(null)
  const [libraryPendingCreate, setLibraryPendingCreate] = useState<LibraryPendingCreate | null>(null)
  const [tagFilters, setTagFilters] = useState<TagFilterState>({})

  useEffect(() => {
    setMountedSections((prev) => (
      prev[sidebarSection]
        ? prev
        : { ...prev, [sidebarSection]: true }
    ))
  }, [sidebarSection])

  useEffect(() => {
    // The settings window renders an early-return tree without GlobalCloseConfirmDialog,
    // so blocking its close here would leave it unclosable with no way to confirm.
    if (isSettingsWindow) return
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const unlistenPromise = getCurrentWindow().onCloseRequested(async (event) => {
          if (useUnsavedChangesStore.getState().hasUnsavedChanges()) {
            event.preventDefault()
            useUnsavedChangesStore.getState().setShowCloseConfirm(true)
          }
        })
        return () => {
          unlistenPromise.then((fn) => fn())
        }
      }).catch(console.error)
    }
  }, [isSettingsWindow])

  const openLibrarySelection = useCallback((target: { id: string; type: LibraryObjectType }) => {
    setSidebarSection('library')
    setLibraryPendingSelection((prev) => ({
      id: target.id,
      type: target.type,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [])

  const openLibraryCreate = useCallback((target: { type: CreatableNotesObjType; date?: string }) => {
    setSidebarSection('library')
    setLibraryPendingCreate((prev) => ({
      type: target.type,
      date: target.date,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [])

  const handleNavigate = (section: string) => {
    setSidebarSection(resolveSectionAlias(section))
  }

  const handleNavigateToPinned = useCallback(async (target: PinnedTarget) => {
    openLibrarySelection({ id: target.id, type: target.type })
  }, [openLibrarySelection])

  const handleToggleTagFilter = useCallback((tag: string) => {
    setTagFilters((prev) => cycleTagFilterState(prev, tag))
  }, [])

  const handleLibraryPendingSelectionHandled = useCallback((nonce: number) => {
    setLibraryPendingSelection((prev) => (prev?.nonce === nonce ? null : prev))
  }, [])

  const handleLibraryPendingCreateHandled = useCallback((nonce: number) => {
    setLibraryPendingCreate((prev) => (prev?.nonce === nonce ? null : prev))
  }, [])

  if (isSettingsWindow) {
    return (
      <div className="h-screen overflow-auto bg-[var(--color-surface-app)] p-4 text-foreground">
        <SettingsPage />
      </div>
    )
  }

  return (
    <>
      <TitleBarHandler />
      <GlobalCloseConfirmDialog />
      <div className="flex h-screen overflow-hidden bg-[var(--color-surface-app)] text-foreground">
        <NavigationSidebar
          currentSection={sidebarSection}
          onNavigate={handleNavigate}
          onNavigateToPinned={handleNavigateToPinned}
          tagFilters={tagFilters}
          onToggleTagFilter={handleToggleTagFilter}
        />

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--color-surface-app)]">
           {mountedSections.library ? (
             <div className={cn('min-h-0 min-w-0 flex-1', sidebarSection === 'library' ? 'flex' : 'hidden')}>
               <LibraryPage
                 pendingSelection={libraryPendingSelection}
                 onPendingSelectionHandled={handleLibraryPendingSelectionHandled}
                 pendingCreate={libraryPendingCreate}
                 onPendingCreateHandled={handleLibraryPendingCreateHandled}
                 tagFilters={tagFilters}
               />
             </div>
           ) : null}

          {mountedSections.calendar ? (
            <div className={cn('min-h-0 min-w-0 flex-1', sidebarSection === 'calendar' ? 'flex' : 'hidden')}>
              <CalendarPage
                tagFilters={tagFilters}
                onOpenObjectTab={async (target) => {
                  openLibrarySelection({ id: target.id, type: target.type })
                }}
                onStartCreateObject={async (target) => {
                  openLibraryCreate(target)
                }}
              />
            </div>
          ) : null}

           {mountedSections.graph ? (
             <div className={cn('min-h-0 min-w-0 flex-1', sidebarSection === 'graph' ? 'flex' : 'hidden')}>
               <GraphErrorBoundary>
                 <GraphPage
                   tagFilters={tagFilters}
                   onOpenNode={async (target) => {
                     openLibrarySelection({ id: target.id, type: target.type })
                   }}
                 />
               </GraphErrorBoundary>
             </div>
           ) : null}
        </div>
      </div>
    </>
  )
}
