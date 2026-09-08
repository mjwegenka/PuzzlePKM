import { Alert, Button, Input } from 'aslan-ui';
import React, { useState, useEffect, useCallback } from 'react'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Cloud,
  FolderKanban,
  FolderOpen,
  FolderSymlink,
  HardDrive,
  Info,
  Loader2,
  Settings,
  Trash2,
} from 'lucide-react'
import {
  addLinkedSources,
  listLinkedSources,
  pickDirectory,
  removeLinkedSource,
  runPuzzlePKMCli,
  scanLinkCandidates,
  type LinkCandidate,
  type LinkedSource,
  type LinkedSourceType,
} from '../../lib/cliService'

interface ConfigState {
  dbPath?: string
  syncRootFolder?: string
  effectiveSyncRootFolder?: string
  resolvedSyncRootFolder?: string
  loaded: boolean
  error?: string
}

interface CliStatus {
  detail?: string
  ok: boolean
  error?: string
  checked: boolean
}

const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:\//

function normalizeSyncRootInput(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed) return ''
  if (trimmed === '/') return '/'
  return trimmed.replace(/\/+$/, '')
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 32) return true
  }
  return false
}

function getSyncRootValidationError(value: string): string | null {
  const normalized = normalizeSyncRootInput(value)
  if (!normalized) return 'Sync root folder path is required (example: /PuzzlePKM).'
  if (hasControlCharacters(normalized)) return 'Path cannot contain control characters.'
  if (normalized === '/') return 'Root folder cannot be "/". Use a dedicated folder like /PuzzlePKM.'
  const isAbsoluteUnix = normalized.startsWith('/')
  const isHomeRelative = normalized === '~' || normalized.startsWith('~/')
  const isAbsoluteWindows = WINDOWS_ABSOLUTE_PATH.test(normalized)
  if (!isAbsoluteUnix && !isHomeRelative && !isAbsoluteWindows) {
    return 'Use an absolute path such as /PuzzlePKM, ~/PuzzlePKM, or C:/PuzzlePKM.'
  }
  return null
}

// DEC-80: a linked directory becomes exactly one object, so the choice between
// Project and Reference Material is deliberate and required — never defaulted.
const LINKED_SOURCE_TYPE_META: Record<
  LinkedSourceType,
  { label: string; description: string; Icon: typeof FolderKanban }
> = {
  project: {
    label: 'Project',
    description: 'Active work you are producing — appears under Projects.',
    Icon: FolderKanban,
  },
  'ref-material': {
    label: 'Reference Material',
    description: 'Source material you read from — appears under Reference Materials.',
    Icon: BookOpen,
  },
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigState>({ loaded: false })
  const [cliStatus, setCliStatus] = useState<CliStatus>({ ok: false, checked: false })
  const [syncRoot, setSyncRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Linked directories (DEC-80) ───────────────────────────────────────────
  const [linkedSources, setLinkedSources] = useState<LinkedSource[]>([])
  const [linkedLoaded, setLinkedLoaded] = useState(false)
  const [linkResult, setLinkResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null)

  // Bulk add: scan a parent folder, review its subfolders, link the checked ones.
  const [scanParent, setScanParent] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<LinkCandidate[]>([])
  const [checkedPaths, setCheckedPaths] = useState<Set<string>>(new Set())
  const [bulkType, setBulkType] = useState<LinkedSourceType | null>(null)
  const [scanning, setScanning] = useState(false)
  const [bulkAdding, setBulkAdding] = useState(false)

  // ── Load current config and CLI status ────────────────────────────────────
  useEffect(() => {
    const checkCli = async () => {
      try {
        // `--version` is not supported by this CLI; use `help` as a reachability probe.
        const res = await runPuzzlePKMCli(['help'])
        if (res.exitCode === 0) {
          setCliStatus({
            ok: true,
            detail: 'CLI responded to `help`',
            checked: true,
          })
        } else {
          setCliStatus({ ok: false, error: res.stderr || 'CLI returned non-zero exit', checked: true })
        }
      } catch (e) {
        setCliStatus({ ok: false, error: String(e), checked: true })
      }
    }

    const loadConfig = async () => {
      try {
        const res = await runPuzzlePKMCli(['settings', 'show'])
        if (res.exitCode === 0) {
          const parsed = JSON.parse(res.stdout)
          setConfig({
            dbPath: parsed?.dbPath,
            syncRootFolder: parsed?.sync?.rootFolder ?? parsed?.sync?.rootFolder,
            effectiveSyncRootFolder: parsed?.sync?.effectiveRootFolder ?? parsed?.sync?.rootFolder ?? parsed?.sync?.rootFolder,
            resolvedSyncRootFolder: parsed?.sync?.resolvedRootFolder,
            loaded: true,
          })
          setSyncRoot(parsed?.sync?.effectiveRootFolder ?? parsed?.sync?.rootFolder ?? parsed?.sync?.rootFolder ?? '')
        } else {
          setConfig({ loaded: true, error: 'Could not load config — using defaults' })
        }
      } catch {
        setConfig({ loaded: true, error: 'CLI settings command not available' })
      }
    }

    checkCli()
    loadConfig()
  }, [])

  const refreshLinkedSources = useCallback(async () => {
    try {
      setLinkedSources(await listLinkedSources())
    } catch {
      setLinkedSources([])
    } finally {
      setLinkedLoaded(true)
    }
  }, [])

  useEffect(() => {
    refreshLinkedSources()
  }, [refreshLinkedSources])

  const handleChooseParent = async () => {
    setLinkResult(null)
    setScanning(true)
    try {
      const parent = await pickDirectory('Choose a folder whose subfolders you want to add')
      if (!parent) return
      const scan = await scanLinkCandidates(parent)
      setScanParent(scan.parent)
      setCandidates(scan.candidates)
      setCheckedPaths(new Set(
        scan.candidates.filter((c) => c.status === 'eligible').map((c) => c.path),
      ))
    } catch (e) {
      setLinkResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setScanning(false)
    }
  }

  const toggleCandidate = (path: string) => {
    setCheckedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const clearScan = () => {
    setScanParent(null)
    setCandidates([])
    setCheckedPaths(new Set())
    setBulkType(null)
  }

  const handleBulkAdd = async () => {
    if (!bulkType || checkedPaths.size === 0) return
    setBulkAdding(true)
    setLinkResult(null)
    try {
      const paths = candidates.filter((c) => checkedPaths.has(c.path)).map((c) => c.path)
      const { added, failed } = await addLinkedSources(paths, bulkType)
      const label = LINKED_SOURCE_TYPE_META[bulkType].label
      const summary = failed.length === 0
        ? `Added ${added.length} ${label}${added.length === 1 ? '' : 's'}. No folders were moved or modified.`
        : `Added ${added.length}, skipped ${failed.length}: ${failed.map((f) => f.error).join(' ')}`
      setLinkResult({ ok: failed.length === 0, msg: summary })
      clearScan()
      await refreshLinkedSources()
    } catch (e) {
      setLinkResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setBulkAdding(false)
    }
  }

  const handleUnlink = async (source: LinkedSource) => {
    setLinkResult(null)
    try {
      await removeLinkedSource(source.path)
      setConfirmUnlink(null)
      setLinkResult({ ok: true, msg: `Unlinked "${source.name}". The folder is still on disk, untouched.` })
      await refreshLinkedSources()
    } catch (e) {
      setLinkResult({ ok: false, msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleSaveSyncRoot = async () => {
    const inputError = getSyncRootValidationError(syncRoot)
    if (inputError) {
      setSaveResult({ ok: false, msg: inputError })
      return
    }
    const normalizedRoot = normalizeSyncRootInput(syncRoot)
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await runPuzzlePKMCli(['settings', 'set', 'root-folder', normalizedRoot])
      if (res.exitCode === 0) {
        const parsed = JSON.parse(res.stdout)
        setSaveResult({ ok: true, msg: 'Sync root folder saved.' })
        setConfig((c) => ({
          ...c,
          syncRootFolder: parsed?.sync?.rootFolder ?? normalizedRoot,
          effectiveSyncRootFolder: parsed?.sync?.effectiveRootFolder ?? normalizedRoot,
          resolvedSyncRootFolder: parsed?.sync?.resolvedRootFolder ?? c.resolvedSyncRootFolder,
        }))
        setSyncRoot(parsed?.sync?.effectiveRootFolder ?? normalizedRoot)
      } else {
        setSaveResult({ ok: false, msg: res.stderr || 'Save failed' })
      }
    } catch (e) {
      setSaveResult({ ok: false, msg: String(e) })
    } finally {
      setSaving(false)
    }
  }

  const syncRootValidationError = getSyncRootValidationError(syncRoot)
  const normalizedSyncRootPreview = normalizeSyncRootInput(syncRoot)

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 pb-10 pr-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-[var(--color-accent-selected)]" />
        <div>
          <h1 className="text-lg font-bold leading-tight text-[var(--color-text-primary)]">
            Settings
          </h1>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
            PuzzlePKM configuration &amp; diagnostics
          </p>
        </div>
      </div>

      {/* ── CLI Status ─────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            CLI Status
          </p>
        </div>

        {!cliStatus.checked ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              Checking CLI…
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              {cliStatus.ok ? (
                <CheckCircle2 className="h-[15px] w-[15px] text-[var(--color-success-main)]" />
              ) : (
                <AlertCircle className="h-[15px] w-[15px] text-rose-300" />
              )}
              <span>
                CLI reachable:{' '}
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: cliStatus.ok ? 'rgba(135,180,135,0.14)' : 'rgba(226,89,89,0.14)',
                    borderColor: cliStatus.ok ? 'rgba(135,180,135,0.34)' : 'rgba(226,89,89,0.34)',
                    color: cliStatus.ok ? 'rgb(182, 224, 182)' : 'rgb(252, 178, 178)',
                  }}
                >
                  {cliStatus.ok ? 'OK' : 'Error'}
                </span>
              </span>
            </div>
            {cliStatus.detail && (
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">{cliStatus.detail}</p>
            )}
            {cliStatus.error && (
              <Alert variant="destructive" className="mt-2 text-xs">
                {cliStatus.error}
              </Alert>
            )}
          </div>
        )}
      </section>

      {/* ── Storage ────────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Local Storage
          </p>
        </div>

        {!config.loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Database path</p>
              <p className="break-all font-mono text-sm leading-6 text-[var(--color-text-primary)]">
                {config.dbPath || '(platform default puzzlepkm app-data folder)'}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-[var(--color-text-secondary)]">Sync root folder</p>
              <p className="break-all text-sm leading-6 text-[var(--color-text-primary)]">{config.syncRootFolder || '(not configured)'}</p>
            </div>
          </div>
        )}
        {config.error && (
          <Alert variant="warning" className="mt-3 text-xs">
            {config.error}
          </Alert>
        )}
      </section>

      {/* ── Sync ───────────────────────────────────────────────────────────── */}
      <section className="space-y-6 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex items-center gap-2">
          <Cloud className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Local Sync
          </p>
        </div>

        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
          Projects and Reference Materials are discovered under your configured sync folder.
          Set the root folder path below.
        </p>

        <div className="space-y-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
              Sync root folder
            </label>
            <Input
            value={syncRoot}
            onChange={(e) => setSyncRoot(e.target.value)}
            placeholder="/PuzzlePKM"
              aria-invalid={Boolean(syncRootValidationError)}
              className={syncRootValidationError ? 'border-[rgba(226,89,89,0.44)] focus-visible:ring-[rgba(226,89,89,0.25)]' : undefined}
          />
            <p className={`text-sm leading-6 ${syncRootValidationError ? 'text-rose-300' : 'text-[var(--color-text-disabled)]'}`}>
              {syncRootValidationError || 'Folder path used by sync'}
            </p>
          </div>

          {!syncRootValidationError && normalizedSyncRootPreview && (
            <p className="break-all text-sm leading-6 text-[var(--color-text-secondary)]">
              Effective sync root:{' '}
              <span className="font-mono text-[var(--color-text-primary)]">{normalizedSyncRootPreview}</span>
            </p>
          )}

          {config.resolvedSyncRootFolder && (
            <p className="break-all text-sm leading-6 text-[var(--color-text-secondary)]">
              Resolved local folder:{' '}
              <span className="font-mono text-[var(--color-text-primary)]">{config.resolvedSyncRootFolder}</span>
            </p>
          )}

          {saveResult && (
            <Alert variant={saveResult.ok ? 'success' : 'destructive'} className="text-xs">
              {saveResult.msg}
            </Alert>
          )}

          <div className="pt-3 pb-2">
            <Button
              disabled={saving || Boolean(syncRootValidationError)}
              onClick={handleSaveSyncRoot}
              size="sm"
              className="self-start"
            >
              {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Save path
            </Button>
          </div>
        </div>

        <div className="h-px bg-[var(--color-border-subtle)]" />

        <div className="space-y-4 pt-2">
          <p className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            Expected folder structure
          </p>
          <pre className="m-0 overflow-auto rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] p-4 text-xs leading-6 text-[var(--color-text-secondary)]">
            {`<sync-root>/
├── daily-notes/
├── topic-notes/
├── habits/
├── projects/       ← optional, created only when a project lives in the sync root
└── ref-materials/  ← optional, created only when a ref material lives in the sync root`}
          </pre>
          <p className="block text-sm leading-6 text-[var(--color-text-disabled)]">
            Projects and reference materials are normally added by linking a folder wherever it already lives,
            from the new-object button in the library toolbar. The two folders above are not created up front;
            they appear only if a project or reference material is stored inside the sync root itself.
          </p>
        </div>
      </section>

      {/* ── Linked directories (DEC-80) ────────────────────────────────────── */}
      <section className="space-y-6 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex items-center gap-2">
          <FolderSymlink className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Linked Directories
          </p>
        </div>

        <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
          Add a folder from anywhere on this Mac without moving it into the sync root. Each linked
          folder becomes exactly one Project or Reference Material, and PuzzlePKM never writes to it,
          renames it, or deletes it.
        </p>

        {/* Existing links */}
        {!linkedLoaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
        ) : linkedSources.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--color-text-disabled)]">No linked directories yet.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {linkedSources.map((source) => {
              const meta = LINKED_SOURCE_TYPE_META[source.objectType]
              const TypeIcon = meta?.Icon ?? FolderKanban
              const confirming = confirmUnlink === source.path
              return (
                <li
                  key={source.path}
                  className="flex items-start gap-3 rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] p-3"
                >
                  <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-selected)]" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">{source.name}</span>
                      <span className="inline-flex items-center rounded-full border border-[var(--color-border-subtle)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                        {meta?.label ?? source.objectType}
                      </span>
                      {!source.available && (
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]"
                          style={{
                            backgroundColor: 'rgba(226,89,89,0.14)',
                            borderColor: 'rgba(226,89,89,0.34)',
                            color: 'rgb(252, 178, 178)',
                          }}
                        >
                          Unavailable
                        </span>
                      )}
                    </div>
                    <p className="break-all font-mono text-xs leading-5 text-[var(--color-text-secondary)]">
                      {source.path}
                    </p>
                    {!source.available && (
                      <p className="text-xs leading-5 text-[var(--color-text-disabled)]">
                        Not reachable right now. Sync skips it and keeps the record.
                      </p>
                    )}
                  </div>
                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="destructive" onClick={() => handleUnlink(source)}>
                        Unlink
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmUnlink(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      aria-label={`Unlink ${source.name}`}
                      onClick={() => setConfirmUnlink(source.path)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {linkResult && (
          <Alert variant={linkResult.ok ? 'success' : 'destructive'} className="text-xs">
            {linkResult.msg}
          </Alert>
        )}

        <p className="text-sm leading-6 text-[var(--color-text-disabled)]">
          To add one folder, use the new-object button in the library toolbar and choose Project or
          Reference Material.
        </p>

        <div className="h-px bg-[var(--color-border-subtle)]" />

        {/* Bulk add: one parent folder, review, then link the checked subfolders */}
        <div className="space-y-4">
          <p className="block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            Add several at once
          </p>

          {!scanParent ? (
            <div className="space-y-2">
              <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
                Choose a folder and every subfolder inside it becomes a candidate. You pick which ones to
                add before anything happens.
              </p>
              <Button size="sm" variant="secondary" disabled={scanning} onClick={handleChooseParent}>
                {scanning
                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  : <FolderOpen className="mr-1 h-3.5 w-3.5" />}
                Choose Parent Folder…
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="break-all text-sm leading-6 text-[var(--color-text-secondary)]">
                Subfolders of <span className="font-mono text-[var(--color-text-primary)]">{scanParent}</span>
              </p>

              {candidates.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--color-text-disabled)]">
                  That folder has no subfolders to add.
                </p>
              ) : (
                <ul className="m-0 max-h-[260px] list-none space-y-1 overflow-auto p-0">
                  {candidates.map((candidate) => {
                    const selectable = candidate.status === 'eligible'
                    const checked = checkedPaths.has(candidate.path)
                    return (
                      <li key={candidate.path}>
                        <label
                          className={`flex items-start gap-2.5 rounded-[8px] border p-2.5 ${selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                          style={{
                            borderColor: checked ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
                            backgroundColor: 'var(--color-surface-app)',
                          }}
                        >
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={checked}
                            disabled={!selectable}
                            onChange={() => toggleCandidate(candidate.path)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-[var(--color-text-primary)]">{candidate.name}</span>
                            {!selectable && (
                              <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-disabled)]">
                                {candidate.reason}
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                  Add the checked folders as
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(Object.keys(LINKED_SOURCE_TYPE_META) as LinkedSourceType[]).map((type) => {
                    const meta = LINKED_SOURCE_TYPE_META[type]
                    const selected = bulkType === type
                    const TypeIcon = meta.Icon
                    return (
                      <button
                        key={type}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setBulkType(type)}
                        className="flex items-center gap-2.5 rounded-[10px] border p-3 text-left transition-colors"
                        style={{
                          borderColor: selected ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
                          backgroundColor: selected ? 'rgba(255,255,255,0.04)' : 'var(--color-surface-app)',
                        }}
                      >
                        <TypeIcon
                          className="h-4 w-4 shrink-0"
                          style={{ color: selected ? 'var(--color-accent-selected)' : 'var(--color-text-secondary)' }}
                        />
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{meta.label}</span>
                      </button>
                    )
                  })}
                </div>
                {checkedPaths.size > 0 && !bulkType && (
                  <p className="text-sm leading-6 text-[var(--color-text-disabled)]">
                    Choose Project or Reference Material to continue. One type applies to the whole batch.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
                <Button
                  size="sm"
                  disabled={bulkAdding || checkedPaths.size === 0 || !bulkType}
                  onClick={handleBulkAdd}
                >
                  {bulkAdding ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  {bulkType
                    ? `Add ${checkedPaths.size} as ${LINKED_SOURCE_TYPE_META[bulkType].label}${checkedPaths.size === 1 ? '' : 's'}`
                    : `Add ${checkedPaths.size} folder${checkedPaths.size === 1 ? '' : 's'}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={clearScan}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── About ──────────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            About PuzzlePKM
          </p>
        </div>
        <div className="space-y-2.5">
          {[
            ['App', 'PuzzlePKM Desktop'],
            ['Architecture', 'CLI-first · Tauri wrapper · React UI'],
            ['Storage', 'Local SQLite via node:sqlite'],
            ['Sync', 'Local folder'],
            ['CLI command', 'puzzlepkm'],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-3 py-1.5">
              <span className="min-w-[110px] text-sm leading-6 text-[var(--color-text-secondary)]">{label}</span>
              <span className="text-sm leading-6 text-[var(--color-text-primary)]">{value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
