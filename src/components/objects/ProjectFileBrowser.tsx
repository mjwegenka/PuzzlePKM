import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ExternalLink,
  FileAudio2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Film,
  Folder,
  Loader2,
  Presentation,
  RefreshCw,
} from 'lucide-react'
import { browseDirectory, openPathInDefaultApp } from '../../lib/cliService'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'

type FileObjectType = 'project' | 'ref-material'

interface ProjectFileBrowserProps {
  type: FileObjectType
  object?: Record<string, unknown>
  embedded?: boolean
}

function joinPath(base: string, child: string): string {
  if (!base) return child
  return `${base.replace(/\/$/, '')}/${child.replace(/^\//, '')}`
}

function fileIconForName(name: string): React.ReactNode {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'bmp'].includes(ext)) {
    return <FileImage className="h-4 w-4 shrink-0 text-emerald-300" />
  }
  if (ext === 'pdf') {
    return <FileText className="h-4 w-4 shrink-0 text-rose-300" />
  }
  if (['md', 'txt', 'rtf'].includes(ext)) {
    return <FileText className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
  }
  if (['csv', 'tsv', 'xls', 'xlsx', 'numbers'].includes(ext)) {
    return <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-300" />
  }
  if (['ppt', 'pptx', 'key'].includes(ext)) {
    return <Presentation className="h-4 w-4 shrink-0 text-amber-300" />
  }
  if (['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'].includes(ext)) {
    return <Film className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
  }
  if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) {
    return <FileAudio2 className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
  }
  if (['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z'].includes(ext)) {
    return <Archive className="h-4 w-4 shrink-0 text-amber-300" />
  }
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'yml', 'yaml', 'toml', 'ini', 'xml', 'html', 'css', 'scss', 'rs', 'swift', 'py', 'sh', 'zsh'].includes(ext)) {
    return <FileCode2 className="h-4 w-4 shrink-0 text-[var(--color-accent-metadata)]" />
  }

  return <FileText className="h-4 w-4 shrink-0 text-[var(--color-text-secondary)]" />
}

export default function ProjectFileBrowser({ type, object, embedded = false }: ProjectFileBrowserProps) {
  const syncPath = String((object?.syncPath ?? object?.syncPath ?? '') as string).trim()
  const objectName = String((object?.name ?? '') as string).trim()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directoryPath, setDirectoryPath] = useState('')
  const [entries, setEntries] = useState<Array<{ kind: 'dir' | 'file'; name: string }>>([])

  const title = useMemo(() => (type === 'project' ? 'Project files' : 'Reference files'), [type])

  const load = useCallback(async () => {
    if (!syncPath) {
      setEntries([])
      setDirectoryPath('')
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await browseDirectory(syncPath, {
        objectType: type,
        objectName,
      })
      setDirectoryPath(result.directoryPath)
      setEntries(result.entries)
    } catch (err) {
      const message = String(err)
      const missingPathMatch = /Path not found:\s*(.+)$/i.exec(message)
      if (missingPathMatch?.[1]) {
        setDirectoryPath(missingPathMatch[1].trim())
        setEntries([])
        setError(null)
        return
      }
      setEntries([])
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [objectName, syncPath, type])

  useEffect(() => {
    void load()
  }, [load])

  const handleOpenEntry = useCallback(
    async (entry: { kind: 'dir' | 'file'; name: string }) => {
      if (!directoryPath) return
      const absolutePath = joinPath(directoryPath, entry.name)
      try {
        await openPathInDefaultApp(absolutePath)
      } catch (err) {
        setError(String(err))
      }
    },
    [directoryPath],
  )

  const handleOpenDirectory = useCallback(async () => {
    if (!directoryPath) return
    try {
      await openPathInDefaultApp(directoryPath)
    } catch (err) {
      setError(String(err))
    }
  }, [directoryPath])

  return (
    <div
      className={embedded
        ? 'flex min-h-[180px] flex-col'
        : `mt-1.5 flex min-h-[180px] flex-col ${type === 'project' ? 'rounded-none border-0 bg-[var(--color-surface-elevated)] p-0' : 'rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-3'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
          {title}
        </p>
        <Button type="button" size="icon" variant="outline" onClick={() => void load()} className="h-8 w-8 rounded-[10px]">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {directoryPath && (
        <button
          type="button"
          onClick={() => void handleOpenDirectory()}
          className="mb-3 flex w-full items-start gap-1.5 text-left group"
          title="Open in Finder"
        >
          <ExternalLink className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--color-text-disabled)] transition-colors group-hover:text-[var(--color-accent-link)]" />
          <span className="break-all text-xs leading-[1.45] text-[var(--color-text-disabled)] transition-colors group-hover:text-[var(--color-accent-link)] group-hover:underline">
            {directoryPath}
          </span>
        </button>
      )}

      {error && <Alert variant="destructive" className="mb-3">{error}</Alert>}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-[18px] w-[18px] animate-spin text-[var(--color-text-secondary)]" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-4 py-5">
          <p className="text-xs italic text-[var(--color-text-disabled)]">
            No files found.
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="space-y-2">
            {entries.map((entry) => (
              <button
                type="button"
                key={`${entry.kind}:${entry.name}`}
                onClick={() => void handleOpenEntry(entry)}
                className="flex w-full items-center gap-3 rounded-[12px] border border-transparent bg-[var(--color-surface-control)] px-3 py-2.5 text-left transition-colors hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]"
              >
                {entry.kind === 'dir'
                  ? <Folder className="h-4 w-4 shrink-0 text-amber-300" />
                  : fileIconForName(entry.name)}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {entry.name}
                  </span>
                  <span className="block truncate text-sm text-[var(--color-text-disabled)]">
                    {entry.kind === 'dir' ? 'Folder' : 'Open in default app'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

