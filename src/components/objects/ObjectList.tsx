import { Input } from 'aslan-ui';
import React, { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getObjectColor } from '../../lib/objectColors'

interface ObjectListItem {
  id: string
  title: string
  date?: string
  preview?: string
  tags?: string[]
}

interface ObjectListProps {
  items: ObjectListItem[]
  type: string
  onSelect: (id: string) => void
  selectedId?: string
  loading?: boolean
}

export default function ObjectList({
  items,
  type,
  onSelect,
  selectedId,
  loading = false,
}: ObjectListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const token = getObjectColor(type)

  const filtered = items.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.date?.includes(searchQuery) ||
    item.preview?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <section className="h-full rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
      <div className="flex h-full flex-col gap-4">
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-secondary)]" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
              No {type} found
            </p>
          ) : (
            filtered.map((item, idx) => (
              <div key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  className="w-full rounded-[10px] px-3 py-4 text-left transition-colors"
                  style={{ backgroundColor: selectedId === item.id ? token.bg : 'transparent' }}
                >
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                        {item.title}
                    </p>
                    <div className="mt-1.5 space-y-1">
                        {item.date && (
                          <p className="text-xs" style={{ color: token.text }}>
                            {item.date}
                          </p>
                        )}
                        {item.preview && (
                          <p className="line-clamp-1 text-xs" style={{ color: token.text }}>
                            {item.preview}
                          </p>
                        )}
                        {item.tags && item.tags.length > 0 && (
                          <div className="mt-2 flex gap-1">
                            {item.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="ui-tag-text rounded-[6px] px-2 py-0.5 text-xs"
                                style={{ backgroundColor: token.bg, color: token.text }}
                              >
                                #{tag}
                              </span>
                            ))}
                            {item.tags.length > 2 && (
                              <span className="text-xs" style={{ color: token.text }}>
                                +{item.tags.length - 2}
                              </span>
                            )}
                          </div>
                        )}
                    </div>
                  </div>
                </button>
                {idx < filtered.length - 1 ? <div className="h-px bg-[var(--color-border-subtle)]" /> : null}
              </div>
          ))
          )}
        </div>
      </div>
    </section>
  )
}

