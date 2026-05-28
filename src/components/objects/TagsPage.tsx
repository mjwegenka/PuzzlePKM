import React, { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, Tag, X } from 'lucide-react'
import ObjectEditor from './ObjectEditor'
import EditorErrorBoundary from '../common/EditorErrorBoundary'
import { listDailyNoteMeta, listTopicNoteMeta, listHabitMeta, getObject } from '../../lib/cliService'
import type { ResolvedObjectRef } from '../../lib/cliService'
import { formatDatePretty } from '../../lib/dateUtils'
import { getObjectDisplayTitle } from '../../lib/objectTypeDefinitions'
import { getObjectColor } from '../../lib/objectColors'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type NoteType = 'daily-note' | 'topic-note' | 'habit'

interface TaggedItem {
  id: string
  type: NoteType
  title: string
  tags: string[]
  date?: string
}

function isNoteType(type: ResolvedObjectRef['type']): type is NoteType {
  return type === 'daily-note' || type === 'topic-note' || type === 'habit'
}

export default function TagsPage() {
  const [items, setItems] = useState<TaggedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState('')
  const [selectedObject, setSelectedObject] = useState<Record<string, unknown> | undefined>()
  const [selectedType, setSelectedType] = useState<NoteType>('daily-note')

   const loadAll = useCallback(async () => {
     setLoading(true)
     try {
       const [dailyRes, topicRes, habitRes] = await Promise.allSettled([
         listDailyNoteMeta(),
         listTopicNoteMeta(),
         listHabitMeta(),
       ])
       const collected: TaggedItem[] = []
       if (dailyRes.status === 'fulfilled') {
         for (const n of dailyRes.value) {
            collected.push({ id: n.id, type: 'daily-note', title: getObjectDisplayTitle('daily-note', n), date: n.date, tags: n.tags })
         }
       }
       if (topicRes.status === 'fulfilled') {
         for (const n of topicRes.value) {
            collected.push({ id: n.id, type: 'topic-note', title: getObjectDisplayTitle('topic-note', n), date: n.date, tags: n.tags })
         }
       }
       if (habitRes.status === 'fulfilled') {
         for (const h of habitRes.value) {
           collected.push({ id: h.id, type: 'habit', title: getObjectDisplayTitle('habit', h), date: h.date, tags: h.tags })
         }
       }
       setItems(collected)
     } finally {
       setLoading(false)
     }
   }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ── Aggregate tags ────────────────────────────────────────────────────────
  const tagCounts = new Map<string, number>()
  for (const item of items) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
    }
  }
  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([tag]) => !tagFilter || tag.includes(tagFilter.toLowerCase()))

  const filteredItems = selectedTag
    ? items.filter((o) => o.tags.includes(selectedTag))
    : items

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openItem = async (item: TaggedItem) => {
    setSelectedType(item.type)
    try {
      const full = await getObject(item.type, item.id)
      setSelectedObject({ ...full, type: item.type })
    } catch {
      setSelectedObject({ id: item.id, type: item.type, contentMarkdown: '', tags: item.tags })
    }
  }

  const handleSave = useCallback(
    async (saved: Record<string, unknown>) => {
      await loadAll()
      setSelectedObject({ ...saved, type: selectedType })
    },
    [loadAll, selectedType],
  )

  const handleNavigateToObject = useCallback(async (target: ResolvedObjectRef) => {
    if (!isNoteType(target.type)) return

    try {
      const full = await getObject(target.type, target.id)
      if (full && typeof full === 'object') {
        setSelectedType(target.type)
        setSelectedObject({ ...full, type: target.type })
        return
      }
    } catch {
      // Some habit rows can be stale for direct get calls, try metadata fallback.
    }

    if (target.type === 'habit') {
      const habitsMeta = await listHabitMeta()
      const fallback = habitsMeta.find((item) => item.id === target.id)
      if (fallback) {
        setSelectedType('habit')
        setSelectedObject({ ...fallback, type: 'habit' })
      }
    }
  }, [])

  const totalTagged = items.filter((i) => i.tags.length > 0).length

  return (
    <div className="flex h-full min-h-0 gap-2">
      {/* ── Left: Tag browser ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 w-[280px] shrink-0 flex-col gap-1.5">
        {/* Tag cloud */}
        <section className="flex flex-col gap-3 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-[var(--color-accent-selected)]" />
              <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                Tags ({tagCounts.size})
              </p>
            </div>
            <div className="flex items-center gap-1">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-text-secondary)]" /> : null}
              <Button type="button" variant="ghost" size="icon" onClick={() => void loadAll()} className="h-6 w-6 rounded-[8px]" title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Tag filter */}
          <div className="relative">
            <Input
            placeholder="Filter tags…"
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
              className="pr-8 text-sm"
            />
            {tagFilter ? (
              <button
                type="button"
                onClick={() => setTagFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--color-text-disabled)] transition-colors hover:text-[var(--color-text-primary)]"
                aria-label="Clear tag filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          {/* Chips */}
          <div className="max-h-[220px] overflow-auto">
            {tagCounts.size === 0 && !loading && (
              <p className="text-xs text-[var(--color-text-disabled)]">
                No tags found across your notes.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {selectedTag && (
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  className="inline-flex h-[22px] items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-2.5 text-sm text-[var(--color-text-secondary)]"
                >
                  × Show all
                </button>
              )}
              {sortedTags.map(([tag, count]) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  className="ui-tag-text inline-flex h-[22px] items-center rounded-full border px-2.5 text-sm text-[var(--color-text-secondary)] transition-[filter,background-color,border-color] hover:brightness-110"
                  style={{
                    backgroundColor: selectedTag === tag ? 'var(--color-selected-fill-soft)' : 'var(--color-surface-sunken)',
                    borderColor: selectedTag === tag ? 'var(--color-accent-selected)' : 'var(--color-border-subtle)',
                  }}
                >
                  #{tag} {count}
                </button>
              ))}
            </div>
          </div>

          {/* Stats */}
          <p className="pt-0.5 text-xs text-[var(--color-text-disabled)]">
            {totalTagged} of {items.length} objects have tags
          </p>
        </section>

        {/* Object list */}
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
          <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
              {selectedTag ? <><span className="ui-tag-text">#{selectedTag}</span> — {filteredItems.length} objects</> : `All objects (${items.length})`}
            </p>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredItems.length === 0 ? (
              <p className="block py-6 text-center text-xs text-[var(--color-text-disabled)]">
                {selectedTag ? <>No objects tagged <span className="ui-tag-text">#{selectedTag}</span></> : 'No objects'}
              </p>
            ) : (
              filteredItems.map((item, idx) => (
                <div key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openItem(item)}
                    className="w-full px-4 py-3 text-left"
                    style={{ backgroundColor: selectedObject?.id === item.id ? 'var(--color-selected-fill-soft)' : 'transparent' }}
                  >
                    <p className="text-sm font-medium leading-[1.3] text-[var(--color-text-primary)]">{item.title}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-xs" style={{ color: getObjectColor(item.type).text }}>
                        {item.type === 'daily-note' ? '📓 Daily Note' : item.type === 'habit' ? '🔁 Habit' : '📝 Topic Note'}
                      </span>
                      {item.date ? <span className="text-xs text-[var(--color-text-disabled)]">{formatDatePretty(item.date)}</span> : null}
                      {item.tags.slice(0, 2).map((t) => (
                        <span
                          key={t}
                          className="ui-tag-text rounded-[3px] px-1.5 py-0.5 text-xs"
                          style={{ backgroundColor: getObjectColor(item.type).bg, color: getObjectColor(item.type).text }}
                        >
                          #{t}
                        </span>
                      ))}
                      {item.tags.length > 2 ? <span className="text-xs text-[var(--color-text-disabled)]">+{item.tags.length - 2}</span> : null}
                    </div>
                  </button>
                  {idx < filteredItems.length - 1 ? <div className="h-px bg-[var(--color-border-subtle)]" /> : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* ── Right: Editor ──────────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedObject ? (
          <EditorErrorBoundary>
            <ObjectEditor
              object={selectedObject}
              type={selectedType}
              onSave={handleSave}
              onNavigateToObject={handleNavigateToObject}
            />
          </EditorErrorBoundary>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-[var(--color-border-subtle)] p-4">
            <Tag className="h-11 w-11 text-[var(--color-accent-selected)] opacity-25" />
            <p className="text-center text-sm text-[var(--color-text-disabled)]">
              {selectedTag
                ? <>Select an object tagged <span className="ui-tag-text">#{selectedTag}</span> to edit it</>
                : 'Select a tag to filter, then click an object to edit'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

