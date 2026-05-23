import { useCallback, useMemo, useState } from 'react'
import { Box, CircularProgress, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import NavigationSidebar from './components/NavigationSidebar'
import CalendarPage from './components/CalendarPage'
import ObjectEditor from './components/ObjectEditor'
import NotesPage from './components/NotesPage'
import TagsPage from './components/TagsPage'
import ScripturePage from './components/ScripturePage'
import GraphPage from './components/GraphPage'
import SettingsPage from './components/SettingsPage'
import ObjectDirectoryBrowser from './components/ObjectDirectoryBrowser'
import { getObject, listHabitMeta } from './lib/cliService'
import type { ResolvedObjectRef } from './lib/cliService'
import { formatDatePretty } from './lib/dateUtils'

type Section = 'calendar' | 'library' | 'files' | 'scripture' | 'tags' | 'graph' | 'settings'
type FileObjType = 'project' | 'ref-material'
type NotesObjType = 'topic-note' | 'daily-note' | 'habit'
type WorkspaceObjectType = NotesObjType | FileObjType
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
  scripture: 'Scripture',
  tags: 'Tags',
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
  const value = String(object.title ?? '').trim()
  return value || 'Topic Note'
}

export default function App() {
  const [tabs, setTabs] = useState<WorkspaceTab[]>([
    { id: 'section:calendar', kind: 'section', title: SECTION_LABELS.calendar, section: 'calendar' },
  ])
  const [activeTabId, setActiveTabId] = useState('section:calendar')
  const [sidebarSection, setSidebarSection] = useState<Section>('calendar')

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
        const fallback: WorkspaceTab = { id: 'section:calendar', kind: 'section', title: SECTION_LABELS.calendar, section: 'calendar' }
        setActiveTabId(fallback.id)
        setSidebarSection('calendar')
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

  const renderSection = (section: Section) => {
    if (section === 'calendar') return <CalendarPage />
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
    if (section === 'scripture') {
      return (
        <ScripturePage
          onOpenObjectTab={async (target) => {
            await openObjectTab(
              { id: target.id, type: target.type },
              { forceNewTab: target.forceNewTab, sourceSection: 'scripture' },
            )
          }}
        />
      )
    }
    if (section === 'tags') return <TagsPage />
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
    <Box sx={{ display: 'flex', bgcolor: '#121315', height: '100vh', overflow: 'hidden', color: '#eceff3' }}>
      <NavigationSidebar
        currentSection={sidebarSection}
        onNavigate={handleNavigate}
        onNavigateToPinned={handleNavigateToPinned}
      />

      <Box sx={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2, gap: 1 }}>
          {showWorkspaceTabBar && (
            <Box sx={{ border: '1px solid rgba(255,255,255,0.09)', borderRadius: 1, bgcolor: '#1a1c1f', px: 1, py: 0.5 }}>
              <Tabs
                value={activeTab?.id ?? false}
                onChange={(_, value: string) => {
                  setActiveTabId(value)
                  const selected = tabs.find((tab) => tab.id === value)
                  if (selected?.kind === 'section') setSidebarSection(selected.section)
                }}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  minHeight: 34,
                  '& .MuiTabs-indicator': { bgcolor: '#4f8fed' },
                  '& .MuiTab-root': { minHeight: 34, textTransform: 'none', minWidth: 0, px: 1 },
                }}
              >
                {tabs.map((tab) => (
                  <Tab
                    key={tab.id}
                    value={tab.id}
                    label={(
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography variant="caption" sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tab.title}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeTab(tab.id)
                          }}
                          sx={{ p: 0.15, color: '#b8bec8' }}
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
              ) : (
                <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
                  <ObjectEditor
                    object={activeTab.object}
                    type={activeTab.objectType}
                    onSave={(saved) => handleObjectSave(activeTab.id, activeTab.objectType, saved)}
                    onNavigateToObject={handleNavigateFromEditor}
                  />
                  {(activeTab.objectType === 'project' || activeTab.objectType === 'ref-material') && (
                    <ObjectDirectoryBrowser object={activeTab.object} type={activeTab.objectType} />
                  )}
                </Stack>
              )
            ) : null}
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
        color: '#9198a3',
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
