import React, { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle2, Cloud, HardDrive, Info, Loader2, Settings } from 'lucide-react'
import { runPuzzlePKMCli } from '../../lib/cliService'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

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

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigState>({ loaded: false })
  const [cliStatus, setCliStatus] = useState<CliStatus>({ ok: false, checked: false })
  const [syncRoot, setSyncRoot] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null)

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
    <div className="mx-auto flex max-w-[680px] flex-col gap-2.5 pb-4 pr-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-[var(--color-accent-selected)]" />
        <div>
          <h1 className="text-lg font-bold leading-tight text-[var(--color-text-primary)]">
            Settings
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            PuzzlePKM configuration &amp; diagnostics
          </p>
        </div>
      </div>

      {/* ── CLI Status ─────────────────────────────────────────────────────── */}
      <section className="rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
        <div className="mb-3 flex items-center gap-2">
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
          <div className="space-y-2">
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
              <p className="text-sm text-[var(--color-text-secondary)]">{cliStatus.detail}</p>
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
      <section className="rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Local Storage
          </p>
        </div>

        {!config.loaded ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-secondary)]" />
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm text-[var(--color-text-secondary)]">Database path</p>
              <p className="break-all font-mono text-xs text-[var(--color-text-primary)]">
                {config.dbPath || '(platform default puzzlepkm app-data folder)'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-text-secondary)]">Sync root folder</p>
              <p className="break-all text-xs text-[var(--color-text-primary)]">{config.syncRootFolder || '(not configured)'}</p>
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
      <section className="rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Cloud className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            Local Sync
          </p>
        </div>

        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          Projects and Reference Materials are discovered under your configured sync folder.
          Set the root folder path below.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
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
            <p className={`text-xs ${syncRootValidationError ? 'text-rose-300' : 'text-[var(--color-text-disabled)]'}`}>
              {syncRootValidationError || 'Folder path used by sync'}
            </p>
          </div>

          {!syncRootValidationError && normalizedSyncRootPreview && (
            <p className="break-all text-xs text-[var(--color-text-secondary)]">
              Effective sync root:{' '}
              <span className="font-mono text-[var(--color-text-primary)]">{normalizedSyncRootPreview}</span>
            </p>
          )}

          {config.resolvedSyncRootFolder && (
            <p className="break-all text-xs text-[var(--color-text-secondary)]">
              Resolved local folder:{' '}
              <span className="font-mono text-[var(--color-text-primary)]">{config.resolvedSyncRootFolder}</span>
            </p>
          )}

          {saveResult && (
            <Alert variant={saveResult.ok ? 'success' : 'destructive'} className="text-xs">
              {saveResult.msg}
            </Alert>
          )}

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

        <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

        <p className="mb-2 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Expected folder structure
        </p>
        <pre className="m-0 overflow-auto rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] p-3 text-xs text-[var(--color-text-secondary)]">
          {`<sync-root>/
└── ...
    ├── projects/      ← each sub-folder = one Project
    ├── ref-materials/ ← each sub-folder = one Ref Material
    ├── daily-notes/
    ├── topic-notes/
    └── habits/`}
        </pre>
        <p className="mt-2 block text-xs text-[var(--color-text-disabled)]">
          New projects and reference materials are added by creating folders in the sync root, not through
          the app.
        </p>
      </section>

      {/* ── About ──────────────────────────────────────────────────────────── */}
      <section className="rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-[var(--color-accent-selected)]" />
          <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
            About PuzzlePKM
          </p>
        </div>
        <div className="space-y-2">
          {[
            ['App', 'PuzzlePKM Desktop'],
            ['Architecture', 'CLI-first · Tauri wrapper · React UI'],
            ['Storage', 'Local SQLite via node:sqlite'],
            ['Sync', 'Local folder'],
            ['CLI command', 'puzzlepkm'],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-3 py-1">
              <span className="min-w-[110px] text-sm text-[var(--color-text-secondary)]">{label}</span>
              <span className="text-sm text-[var(--color-text-primary)]">{value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
