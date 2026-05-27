import React, { useState, useEffect, useCallback } from 'react'
import { BookOpenText, FileText, Folder, Loader2, Plus, RefreshCw } from 'lucide-react'

import { listFileMeta } from '../../lib/cliService'
import { Alert } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'

interface FileItem {
  id: string
  name: string
  author?: string
  syncPath: string
  type: 'project' | 'ref-material'
}

interface FileExplorerProps {
  onSelect: (id: string, type: 'project' | 'ref-material') => void
  selectedId?: string
  onCreateNew?: (type: 'project' | 'ref-material') => void
  /** Increment this to trigger a list reload (e.g. after a rename/save). */
  refreshKey?: number
}

export default function FileExplorer({ onSelect, selectedId, onCreateNew, refreshKey }: FileExplorerProps) {
  const [items, setItems] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'author'>('name')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const raw = await listFileMeta()
      setItems(raw)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const filterText = filter.toLowerCase()
  const matchesFilter = (i: FileItem) =>
    i.name.toLowerCase().includes(filterText) ||
    (i.author ?? '').toLowerCase().includes(filterText)
  const compareItems = (a: FileItem, b: FileItem) => {
    if (sortBy === 'author') {
      const byAuthor = (a.author ?? '').localeCompare(b.author ?? '', undefined, { sensitivity: 'base' })
      if (byAuthor !== 0) return byAuthor
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }

  const projects = items
    .filter((i) => i.type === 'project' && matchesFilter(i))
    .sort(compareItems)
  const refMaterials = items
    .filter((i) => i.type === 'ref-material' && matchesFilter(i))
    .sort(compareItems)

  return (
    <section className="flex h-full flex-col rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Files</h2>
        <Button type="button" size="icon" variant="ghost" onClick={() => void load()} title="Refresh" className="h-8 w-8 rounded-[10px]">
          <RefreshCw className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <div className="mb-4 flex gap-2">
        <Input
          placeholder="Filter by name/author…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1"
        />
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as 'name' | 'author')}>
          <SelectTrigger className="min-w-[120px]">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="author">Author</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? <Alert variant="destructive" className="mb-3 text-xs">{error}</Alert> : null}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <SectionHeader
            label="Projects"
            icon={<Folder className="mr-1 h-3.5 w-3.5 text-amber-300" />}
            onAdd={onCreateNew ? () => onCreateNew('project') : undefined}
          />
          <div className="mb-2">
            {projects.length === 0 ? (
              <EmptyNote text="No projects" />
            ) : (
              projects.map((item, idx) => (
                <FileListItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  showDivider={idx < projects.length - 1}
                  onSelect={onSelect}
                  icon={<Folder className="mr-3 h-4 w-4 shrink-0 text-amber-300" />}
                />
              ))
            )}
          </div>

          <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

          <SectionHeader
            label="Reference Materials"
            icon={<BookOpenText className="mr-1 h-3.5 w-3.5 text-[var(--color-accent-metadata)]" />}
            onAdd={onCreateNew ? () => onCreateNew('ref-material') : undefined}
          />
          <div>
            {refMaterials.length === 0 ? (
              <EmptyNote text="No reference materials" />
            ) : (
              refMaterials.map((item, idx) => (
                <FileListItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  showDivider={idx < refMaterials.length - 1}
                  onSelect={onSelect}
                  icon={<FileText className="mr-3 h-4 w-4 shrink-0 text-[var(--color-accent-metadata)]" />}
                />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function SectionHeader({
  label,
  icon,
  onAdd,
}: {
  label: string
  icon: React.ReactNode
  onAdd?: () => void
}) {
  return (
    <div className="flex items-center justify-between px-0.5 py-1">
      <div className="flex items-center">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">{label}</p>
      </div>
      {onAdd ? (
        <Button type="button" size="icon" variant="ghost" onClick={onAdd} className="h-6 w-6 rounded-[8px]">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}

function FileListItem({
  item,
  selected,
  showDivider,
  onSelect,
  icon,
}: {
  item: FileItem
  selected: boolean
  showDivider: boolean
  onSelect: (id: string, type: 'project' | 'ref-material') => void
  icon: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(item.id, item.type)}
        className="flex w-full items-start rounded-[8px] px-3 py-3 text-left transition-colors hover:bg-[var(--color-surface-sunken)]"
        style={{ backgroundColor: selected ? 'var(--color-selected-fill-soft)' : 'transparent' }}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-[var(--color-text-primary)]">{item.name}</span>
          {item.type === 'ref-material' && item.author ? (
            <span className="block text-[11px] text-[var(--color-text-secondary)]">by {item.author}</span>
          ) : null}
          {item.syncPath && item.syncPath !== '(no path)' ? (
            <span className="block truncate text-[11px] text-[var(--color-text-disabled)]">{item.syncPath}</span>
          ) : null}
        </span>
      </button>
      {showDivider ? <div className="h-px bg-[var(--color-border-subtle)]" /> : null}
    </div>
  )
}

function EmptyNote({ text }: { text: string }) {
  return <p className="block px-1 py-0.5 text-xs italic text-[var(--color-text-disabled)]">{text}</p>
}
