import { useCallback, useState } from 'react'
import NavigationSidebar from './components/app-shell/NavigationSidebar'
import CalendarPage from './components/calendar/CalendarPage'
import NotesPage from './components/notes/NotesPage'
import GraphPage from './components/graph/GraphPage'
import SettingsPage from './components/app-shell/SettingsPage'
import { cn } from './lib/utils'

type Section = 'calendar' | 'library' | 'graph' | 'settings'
type FileObjType = 'project' | 'ref-material'
type NotesObjType = 'topic-note' | 'daily-note' | 'habit'
type MetaObjType = 'scripture' | 'tag'
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

function resolveSectionAlias(section: string): Section {
  if (section === 'scripture' || section === 'tags' || section === 'files') return 'library'
  if (section === 'calendar' || section === 'library' || section === 'graph' || section === 'settings') {
    return section
  }
  return 'library'
}

export default function App() {
  const [sidebarSection, setSidebarSection] = useState<Section>('library')
  const [libraryPendingSelection, setLibraryPendingSelection] = useState<LibraryPendingSelection | null>(null)

  const openLibrarySelection = useCallback((target: { id: string; type: LibraryObjectType }) => {
    setSidebarSection('library')
    setLibraryPendingSelection((prev) => ({
      id: target.id,
      type: target.type,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [])

  const handleNavigate = (section: string) => {
    setSidebarSection(resolveSectionAlias(section))
  }

  const handleNavigateToPinned = useCallback(async (target: PinnedTarget) => {
    openLibrarySelection({ id: target.id, type: target.type })
  }, [openLibrarySelection])

  const handleLibraryPendingSelectionHandled = useCallback((nonce: number) => {
    setLibraryPendingSelection((prev) => (prev?.nonce === nonce ? null : prev))
  }, [])

  return (
    <div className="h-screen overflow-hidden bg-[var(--color-surface-app)] p-3 text-foreground sm:p-4">
      <div className="ui-shell-panel flex h-full overflow-hidden border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] shadow-[0_10px_36px_rgba(0,0,0,0.28)]">
        <NavigationSidebar
          currentSection={sidebarSection}
          onNavigate={handleNavigate}
          onNavigateToPinned={handleNavigateToPinned}
        />

        <div className="flex min-h-0 min-w-0 flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0))]">
          <div className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
            <div className="ui-shell-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-[color:rgba(23,23,25,0.96)]">
              <div className="flex min-h-0 flex-1 overflow-hidden p-2 sm:p-3">
                <div className={cn('min-h-0 min-w-0 flex-1', sidebarSection === 'library' ? 'flex' : 'hidden')}>
                  <NotesPage
                    pendingSelection={libraryPendingSelection}
                    onPendingSelectionHandled={handleLibraryPendingSelectionHandled}
                  />
                </div>

                {sidebarSection === 'calendar' ? (
                  <CalendarPage
                    onOpenObjectTab={async (target) => {
                      openLibrarySelection({ id: target.id, type: target.type })
                    }}
                  />
                ) : null}

                {sidebarSection === 'graph' ? (
                  <GraphPage
                    onOpenNode={async (target) => {
                      openLibrarySelection({ id: target.id, type: target.type })
                    }}
                  />
                ) : null}

                {sidebarSection === 'settings' ? (
                  <div className="min-h-0 flex-1 overflow-auto">
                    <SettingsPage />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
