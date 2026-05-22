import { useState, useCallback } from 'react'
import { Box, Stack } from '@mui/material'
import NavigationSidebar from './components/NavigationSidebar'
import CalendarPage from './components/CalendarPage'
import FileExplorer from './components/FileExplorer'
import ObjectEditor from './components/ObjectEditor'
import NotesPage from './components/NotesPage'
import TagsPage from './components/TagsPage'
import ScripturePage from './components/ScripturePage'
import GraphPage from './components/GraphPage'
import SettingsPage from './components/SettingsPage'
import { getObject } from './lib/cliService'

type Section = 'calendar' | 'library' | 'files' | 'scripture' | 'tags' | 'graph' | 'settings'
type FileObjType = 'project' | 'ref-material'
type NotesObjType = 'topic-note' | 'daily-note' | 'habit'
type PinnedObjType = NotesObjType | FileObjType

interface PinnedTarget {
  id: string
  type: PinnedObjType
}

export default function App() {
  const [currentSection, setCurrentSection] = useState<Section>('calendar')
  const [fileSelectedId, setFileSelectedId] = useState<string | undefined>()
  const [fileSelectedType, setFileSelectedType] = useState<FileObjType>('project')
  const [fileObject, setFileObject] = useState<Record<string, unknown> | undefined>()
  const [fileExplorerRefreshKey, setFileExplorerRefreshKey] = useState(0)
  const [notesSelectionRequest, setNotesSelectionRequest] = useState<{ id: string; type: NotesObjType; nonce: number } | null>(null)

  const handleNavigate = (section: string) => {
    setCurrentSection(section as Section)
  }

  const handleNavigateToPinned = useCallback(async (target: PinnedTarget) => {
    if (target.type === 'project' || target.type === 'ref-material') {
      setCurrentSection('files')
      setFileSelectedId(target.id)
      setFileSelectedType(target.type)
      try {
        const full = await getObject(target.type, target.id)
        setFileObject({ ...full, type: target.type })
      } catch (err) {
        console.error('Failed to load pinned file object:', err)
        setFileObject(undefined)
      }
      return
    }

    setCurrentSection('library')
    setNotesSelectionRequest((prev) => ({ id: target.id, type: target.type as NotesObjType, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  // ── Files section handlers ───────────────────────────────────────────────
  const handleFileSelect = useCallback(async (id: string, type: FileObjType) => {
    setFileSelectedId(id)
    setFileSelectedType(type)
    try {
      const full = await getObject(type, id)
      setFileObject({ ...full, type })
    } catch (err) {
      console.error('Failed to load file object:', err)
      setFileObject(undefined)
    }
  }, [])

  const handleCreateNew = useCallback((type: FileObjType) => {
    setFileSelectedId(undefined)
    setFileSelectedType(type)
    setFileObject(undefined)
  }, [])

  const handleFileSave = useCallback(
    async (saved: Record<string, unknown>) => {
      setFileObject({ ...saved, type: fileSelectedType })
      setFileSelectedId(saved.id as string)
      setFileExplorerRefreshKey((k) => k + 1)
    },
    [fileSelectedType],
  )

  // ── New Note: after save, jump to calendar ───────────────────────────────
  return (
    <Box sx={{ display: 'flex', bgcolor: '#0b1828', height: '100vh', overflow: 'hidden', color: '#e4f0fb' }}>
      <NavigationSidebar
        currentSection={currentSection}
        onNavigate={handleNavigate}
        onNavigateToPinned={handleNavigateToPinned}
      />

      <Box sx={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
            p: 2,
            minHeight: 0,
          }}
        >
          {/* ── CALENDAR ─────────────────────────────────────────────────── */}
          {currentSection === 'calendar' && <CalendarPage />}

          {/* ── LIBRARY ──────────────────────────────────────────────────── */}
          {currentSection === 'library' && (
            <NotesPage pendingSelection={notesSelectionRequest} />
          )}

          {/* ── FILES (internal — reachable via pinned project/ref-material) */}
          {currentSection === 'files' && (
            <Stack direction="row" spacing={2} sx={{ height: '100%', minHeight: 0 }}>
              <Box sx={{ width: 300, flexShrink: 0 }}>
                <FileExplorer
                  onSelect={handleFileSelect}
                  selectedId={fileSelectedId}
                  onCreateNew={handleCreateNew}
                  refreshKey={fileExplorerRefreshKey}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {fileObject ? (
                  <ObjectEditor
                    object={fileObject}
                    type={fileSelectedType}
                    onSave={handleFileSave}
                  />
                ) : (
                  <EmptyFilesPrompt />
                )}
              </Box>
            </Stack>
          )}

          {/* ── SCRIPTURE ─────────────────────────────────────────────────── */}
          {currentSection === 'scripture' && <ScripturePage />}

          {/* ── TAGS ─────────────────────────────────────────────────────── */}
          {currentSection === 'tags' && <TagsPage />}

          {/* ── GRAPH ────────────────────────────────────────────────────── */}
          {currentSection === 'graph' && <GraphPage />}

          {/* ── SETTINGS ─────────────────────────────────────────────────── */}
          {currentSection === 'settings' && (
            <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
              <SettingsPage />
            </Box>
          )}
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
        border: '1px dashed #1c3558',
        borderRadius: '8px',
        p: 4,
        gap: 2,
        color: '#4a6a8a',
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
