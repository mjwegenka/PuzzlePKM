import { useCallback, useMemo, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import NavigationSidebar from './components/app-shell/NavigationSidebar'
import CalendarPage from './components/calendar/CalendarPage'
import ObjectEditor from './components/objects/ObjectEditor'
import NotesPage from './components/notes/NotesPage'
import GraphPage from './components/graph/GraphPage'
import SettingsPage from './components/app-shell/SettingsPage'
import ObjectMetaDetailPanel from './components/objects/ObjectMetaDetailPanel'
import { getObject, listHabitMeta } from './lib/cliService'
import type { ResolvedObjectRef } from './lib/cliService'
import { formatDatePretty } from './lib/dateUtils'
import { cn } from './lib/utils'

type Section = 'calendar' | 'library' | 'files' | 'graph' | 'settings'
type FileObjType = 'project' | 'ref-material'
type NotesObjType = 'topic-note' | 'daily-note' | 'habit'
type MetaObjType = 'scripture' | 'tag'
type WorkspaceObjectType = NotesObjType | FileObjType | MetaObjType
type PinnedObjType = NotesObjType | FileObjType

type WorkspaceTab =
  | { id: string; kind: 'section'; title: string; section: Section }
  | { id: string; kind: 'object'; title: string; objectType: WorkspaceObjectType; objectId: string; object: Record<string, unknown> | null; loading: boolean }

interface PinnedTarget {
  id: string
  type: PinnedObjType
}

const SECTION_LABELS: Record<Section, string> = {
  calendar: 'Calendar',
  library: 'Library',
  files: 'Files',
  graph: 'Graph',
  settings: 'Settings',
}

function resolveSectionAlias(section: string): Section {
  if (section === 'scripture' || section === 'tags') return 'library'
  if (section === 'calendar' || section === 'library' || section === 'files' || section === 'graph' || section === 'settings') {
    return section
  }
  return 'library'
}

function getObjectTabTitle(type: WorkspaceObjectType, object: Record<string, unknown>): string {
  if (type === 'daily-note') {
    const value = String(object.date ?? '').trim()
    return value ? formatDatePretty(value) : 'Daily Note'
  }
  if (type === 'habit') {
    const value = String(object.text ?? '').trim()
    return value || 'Habit'
  }
  if (type === 'project') {
    const value = String(object.name ?? '').trim()
    return value || 'Project'
  }
  if (type === 'ref-material') {
    const value = String(object.name ?? '').trim()
    return value || 'Reference Material'
  }
  if (type === 'scripture') {
    const value = String(object.reference ?? '').trim()
    return value || 'Scripture'
  }
  if (type === 'tag') {
    const display = String(object.displayName ?? object.name ?? '').trim()
    return display ? `#${display}` : 'Tag'
  }
  const value = String(object.title ?? '').trim()
  return value || 'Topic Note'
}

export default function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'section:library', kind: 'section', title: SECTION_LABELS.library, section: 'library' },
  ])
  const [activeTabId, setActiveTabId] = useState('section:library')
  const [sidebarSection, setSidebarSection] = useState<Section>('library')

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs],
  )
  const showWorkspaceTabBar = tabs.length > 1

  const ensureSectionTab = useCallback((section: Section): string => {
    const existing = tabs.find((tab) => tab.kind === 'section' && tab.section === section)
    if (existing) {
      setActiveTabId(existing.id)
      setSidebarSection(section)
      return existing.id
    }

    const id = `section:${section}`
    setTabs((prev) => [...prev, { id, kind: 'section', title: SECTION_LABELS[section], section }])
    setActiveTabId(id)
    setSidebarSection(section)
    return id
  }, [tabs])

  const openObjectTab = useCallback(async (
    target: { id: string; type: WorkspaceObjectType },
    options?: { forceNewTab?: boolean; sourceSection?: Section },
  ) => {
    const forceNewTab = Boolean(options?.forceNewTab)

    if (!forceNewTab) {
      const existing = tabs.find((tab) => tab.kind === 'object' && tab.objectType === target.type && tab.objectId === target.id)
      if (existing) {
        setActiveTabId(existing.id)
        if (options?.sourceSection) setSidebarSection(options.sourceSection)
        return
      }
    }

    const tabId = `object:${target.type}:${target.id}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 6)}`
    const loadingTab: WorkspaceTab = {
      id: tabId,
      kind: 'object',
      title: `Opening ${target.type}...`,
      objectType: target.type,
      objectId: target.id,
      object: null,
      loading: true,
    }

    setTabs((prev) => [...prev, loadingTab])
    setActiveTabId(tabId)
    if (options?.sourceSection) setSidebarSection(options.sourceSection)

    let loaded: Record<string, unknown> | null = null
    try {
      const full = await getObject(target.type, target.id)
      loaded = { ...(full as unknown as Record<string, unknown>), type: target.type }
    } catch {
      if (target.type === 'habit') {
        const habitsMeta = await listHabitMeta()
        const fallback = habitsMeta.find((item) => item.id === target.id)
        if (fallback) loaded = { ...fallback, type: 'habit' }
      }
    }

    if (!loaded) {
      setTabs((prev) => prev.filter((tab) => tab.id !== tabId))
      return
    }

    const title = getObjectTabTitle(target.type, loaded)
    setTabs((prev) => prev.map((tab) => (
      tab.id === tabId
        ? { ...tab, title, object: loaded, loading: false }
        : tab
    )))
  }, [tabs])

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === tabId)
      if (index === -1) return prev
      const next = prev.filter((tab) => tab.id !== tabId)
      if (next.length === 0) {
        const fallback: WorkspaceTab = { id: 'section:library', kind: 'section', title: SECTION_LABELS.library, section: 'library' }
        setActiveTabId(fallback.id)
        setSidebarSection('library')
        return [fallback]
      }
      if (activeTabId === tabId) {
        const replacement = next[Math.max(0, index - 1)]
        setActiveTabId(replacement.id)
        if (replacement.kind === 'section') setSidebarSection(replacement.section)
      }
      return next
    })
  }, [activeTabId])

  const handleNavigate = (section: string) => {
    ensureSectionTab(resolveSectionAlias(section))
  }

  const handleNavigateToPinned = useCallback(async (target: PinnedTarget) => {
    await openObjectTab(
      { id: target.id, type: target.type },
      { sourceSection: 'library' },
    )
  }, [openObjectTab])

  const handleObjectSave = useCallback((tabId: string, type: WorkspaceObjectType, saved: Record<string, unknown>) => {
    const nextObject = { ...saved, type }
    const nextTitle = getObjectTabTitle(type, nextObject)
    setTabs((prev) => prev.map((tab) => (
      tab.id === tabId && tab.kind === 'object'
        ? { ...tab, title: nextTitle, object: nextObject, objectId: String(saved.id ?? tab.objectId) }
        : tab
    )))
  }, [])

  const handleNavigateFromEditor = useCallback(async (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => {
    await openObjectTab(
      { id: target.id, type: target.type as WorkspaceObjectType },
      { forceNewTab: options?.forceNewTab, sourceSection: sidebarSection },
    )
  }, [openObjectTab, sidebarSection])

  const renderSection = (section: Section) => {
    if (section === 'calendar') {
      return (
        <CalendarPage
          onOpenObjectTab={async (target) => {
            await openObjectTab(
              { id: target.id, type: target.type },
              { forceNewTab: true, sourceSection: 'calendar' },
            )
          }}
        />
      )
    }
    if (section === 'library') {
      return (
        <NotesPage
          onOpenObjectTab={async (target) => {
            await openObjectTab(
              { id: target.id, type: target.type },
              { forceNewTab: target.forceNewTab, sourceSection: 'library' },
            )
          }}
        />
      )
    }
    if (section === 'graph') {
      return (
        <GraphPage
          onOpenNode={async (target) => {
            await openObjectTab(
              { id: target.id, type: target.type },
              { forceNewTab: true, sourceSection: 'graph' },
            )
          }}
        />
      )
    }
    if (section === 'settings') {
      return (
        <div className="min-h-0 flex-1 overflow-auto">
          <SettingsPage />
        </div>
      )
    }
    return <EmptyFilesPrompt />
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-background text-foreground">
      <NavigationSidebar
        currentSection={sidebarSection}
        onNavigate={handleNavigate}
        onNavigateToPinned={handleNavigateToPinned}
      />

      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col bg-background px-2 pb-2 pt-0.5">
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
              showWorkspaceTabBar && 'rounded-md border border-border bg-card',
            )}
          >
          {showWorkspaceTabBar && (
            <div className="border-b border-border bg-card px-1.5">
              <div aria-label="Workspace navigation tabs" className="flex min-h-12 items-center gap-1 overflow-x-auto py-1">
                {tabs.map((tab) => {
                  const isActive = activeTab?.id === tab.id
                  return (
                    <div
                      key={tab.id}
                      onClick={() => {
                        setActiveTabId(tab.id)
                        if (tab.kind === 'section') setSidebarSection(tab.section)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setActiveTabId(tab.id)
                          if (tab.kind === 'section') setSidebarSection(tab.section)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'group inline-flex min-h-9 min-w-0 items-center gap-1 rounded-t-md px-2 py-0 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                        isActive && 'bg-muted text-foreground',
                      )}
                    >
                      <span className="max-w-[180px] truncate text-sm font-medium leading-tight">{tab.title}</span>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          closeTab(tab.id)
                        }}
                        className="inline-flex h-4 w-4 items-center justify-center rounded-sm opacity-70 transition-opacity hover:bg-muted-foreground/20 hover:opacity-100"
                        aria-label={`Close ${tab.title} tab`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            {activeTab?.kind === 'section' ? (
              renderSection(activeTab.section)
            ) : activeTab?.kind === 'object' ? (
              activeTab.loading || !activeTab.object ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : activeTab.objectType === 'scripture' || activeTab.objectType === 'tag' ? (
                <ObjectMetaDetailPanel
                  object={activeTab.object}
                  type={activeTab.objectType}
                  flatTop={showWorkspaceTabBar}
                  onNavigateToObject={handleNavigateFromEditor}
                />
              ) : (
                <ObjectEditor
                  object={activeTab.object}
                  type={activeTab.objectType}
                  flatTop={showWorkspaceTabBar}
                  onSave={(saved) => handleObjectSave(activeTab.id, activeTab.objectType, saved)}
                  onNavigateToObject={handleNavigateFromEditor}
                />
              )
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyFilesPrompt() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/10 p-4 text-muted-foreground">
      <div className="text-[40px] opacity-40">🗂</div>
      <p className="m-0 text-center text-sm">
        Select a project or reference material to view and edit.
        <br />
        Add new ones by creating folders in your sync root.
      </p>
    </div>
  )
}
