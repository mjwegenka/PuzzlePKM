import { useCallback, useMemo, useState } from 'react'
import { Box, CircularProgress, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { getCurrentWindow } from '@tauri-apps/api/window'
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
    ensureSectionTab(section as Section)
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

  const handleTopDragMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const tauriInvoke =
      typeof window !== 'undefined' &&
      typeof (window as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === 'function'
    if (!tauriInvoke) return
    void getCurrentWindow().startDragging().catch(() => {
      // Ignore if the native drag API is temporarily unavailable.
    })
  }, [])

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
        <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <SettingsPage />
        </Box>
      )
    }
    return <EmptyFilesPrompt />
  }

  return (
    <Box sx={{ display: 'flex', bgcolor: 'surface.app', height: '100vh', overflow: 'hidden', color: 'text.primary', position: 'relative' }}>
      <Box
        data-tauri-drag-region
        onMouseDown={handleTopDragMouseDown}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 'calc(env(titlebar-area-height, 0px) + 18px)',
          zIndex: 5,
          pointerEvents: 'auto',
          backgroundColor: 'transparent',
        }}
      />
      <NavigationSidebar
        currentSection={sidebarSection}
        onNavigate={handleNavigate}
        onNavigateToPinned={handleNavigateToPinned}
      />

      <Box sx={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, px: 2, pb: 2, pt: 2, bgcolor: 'surface.app' }}>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: showWorkspaceTabBar ? '1px solid' : 'none',
              borderColor: showWorkspaceTabBar ? 'border.subtle' : 'transparent',
              borderRadius: showWorkspaceTabBar ? 1 : 0,
              bgcolor: showWorkspaceTabBar ? 'surface.elevated' : 'surface.app',
            }}
          >
          {showWorkspaceTabBar && (
            <Box sx={{ px: 1.25, bgcolor: 'surface.elevated', borderBottom: '1px solid', borderColor: 'border.subtle' }}>
              <Tabs
                value={activeTab?.id ?? false}
                onChange={(_, value: string) => {
                  setActiveTabId(value)
                  const selected = tabs.find((tab) => tab.id === value)
                  if (selected?.kind === 'section') setSidebarSection(selected.section)
                }}
                aria-label="Workspace navigation tabs"
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 48,
                  '& .MuiTabs-indicator': { display: 'none' },
                  '& .MuiTabs-flexContainer': { alignItems: 'center' },
                  '& .MuiTabs-scroller': { overflow: 'hidden' },
                  '& .MuiTabScrollButton-root': { width: 24, color: 'text.secondary' },
                  '& .MuiTab-root': {
                    minHeight: 48,
                    textTransform: 'none',
                    minWidth: 0,
                    px: 1.25,
                    py: 0,
                    borderRadius: '8px 8px 0 0',
                    color: 'text.secondary',
                    transition: 'color 120ms ease, background-color 120ms ease',
                    '&:hover': {
                      color: 'text.primary',
                      bgcolor: 'surface.sunken',
                    },
                    '&.Mui-selected': {
                      color: 'text.primary',
                      bgcolor: 'surface.sunken',
                    },
                  },
                }}
              >
                {tabs.map((tab) => (
                  <Tab
                    key={tab.id}
                    value={tab.id}
                    disableRipple
                    label={(
                      <Stack direction="row" alignItems="center" spacing={0.6} sx={{ minHeight: 24 }}>
                        <Typography variant="body2" sx={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, lineHeight: 1.2 }}>
                          {tab.title}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeTab(tab.id)
                          }}
                          sx={{
                            p: 0.1,
                            color: 'inherit',
                            opacity: 0.72,
                            '&:hover': { opacity: 1, bgcolor: 'action.hover' },
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Stack>
                    )}
                  />
                ))}
              </Tabs>
            </Box>
          )}

          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
            {activeTab?.kind === 'section' ? (
              renderSection(activeTab.section)
            ) : activeTab?.kind === 'object' ? (
              activeTab.loading || !activeTab.object ? (
                <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CircularProgress size={24} />
                </Box>
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
          </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function EmptyFilesPrompt() {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed rgba(255,255,255,0.09)',
        borderRadius: '8px',
        p: 4,
        gap: 2,
        color: 'text.disabled',
      }}
    >
      <Box sx={{ fontSize: 40, opacity: 0.35 }}>🗂</Box>
      <Box component="p" sx={{ m: 0, fontSize: '14px', textAlign: 'center' }}>
        Select a project or reference material to view and edit.
        <br />
        Add new ones by creating folders in your sync root.
      </Box>
    </Box>
  )
}
