import { Button } from 'aslan-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react'
import React, { useMemo } from 'react'

import type { ResolvedObjectRef } from '../../lib/cliService'
import { getScriptureSection, getScriptureSectionColor, getScriptureSectionLabel } from '../../lib/objectColors'
import { getObjectDisplayTitle, isObjectType } from '../../lib/objectTypeDefinitions'

interface ScriptureChapterPanelProps {
  object?: Record<string, unknown>
  flatTop?: boolean
  onNavigateToObject?: (target: ResolvedObjectRef, options?: { forceNewTab?: boolean }) => void | Promise<void>
  onOpenChapter?: (chapterId: string) => void | Promise<void>
}

interface ChapterNote {
  id: string
  type: string
  title?: string
  date?: string
  syncPath?: string
}

interface ChapterReference {
  id: string
  reference: string
  passageUrl: string
  verseStart: number | null
  verseEnd: number | null
  noteCount: number
  linkedNotes: ChapterNote[]
}

/**
 * DEC-77: How a citation's span reads in the chapter view. A citation with no
 * verses covers the whole chapter; an open-ended one runs to the chapter's end
 * (the shape produced by a reference that crosses a chapter boundary).
 */
function verseSpanLabel(verseStart: number | null, verseEnd: number | null): string {
  if (verseStart === null) return 'Whole chapter'
  if (verseEnd === null) return `vv. ${verseStart}–end`
  if (verseEnd === verseStart) return `v. ${verseStart}`
  return `vv. ${verseStart}–${verseEnd}`
}

function toTarget(row: ChapterNote): ResolvedObjectRef | null {
  const id = String(row.id ?? '').trim()
  const type = String(row.type ?? '').trim() as ResolvedObjectRef['type']
  if (!id || !type) return null
  return { id, type, syncPath: String(row.syncPath ?? '') }
}

function noteLabel(row: ChapterNote): string {
  const type = String(row.type ?? '').trim()
  if (isObjectType(type)) return getObjectDisplayTitle(type, row as unknown as Record<string, unknown>)
  return String(row.title ?? row.date ?? row.id ?? '').trim() || 'Note'
}

export default function ScriptureChapterPanel({
  object,
  flatTop = false,
  onNavigateToObject,
  onOpenChapter,
}: ScriptureChapterPanelProps) {
  const reference = String(object?.reference ?? 'Chapter')
  const bookOrder = Number(object?.bookOrder ?? 0)
  const passageUrl = String(object?.passageUrl ?? '').trim()

  const references = useMemo(
    () => (Array.isArray(object?.references) ? (object.references as ChapterReference[]) : []),
    [object],
  )
  const noteCount = useMemo(
    () => (Array.isArray(object?.linkedNotes) ? (object.linkedNotes as ChapterNote[]).length : 0),
    [object],
  )

  const adjacent = (object?.adjacentChapters ?? {}) as {
    previous?: { id?: string; reference?: string } | null
    next?: { id?: string; reference?: string } | null
  }
  const previous = adjacent.previous ?? null
  const next = adjacent.next ?? null

  const sectionLabel = getScriptureSectionLabel(getScriptureSection(bookOrder))
  const sectionColor = getScriptureSectionColor(bookOrder)

  return (
    <div
      className={flatTop
        ? 'flex min-h-0 flex-1 overflow-hidden bg-transparent'
        : 'flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-6'}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className={flatTop ? 'shrink-0 px-6 pb-2.5 pt-6' : 'shrink-0 pb-2.5'}>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: sectionColor }}
            />
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
              {sectionLabel}
            </p>
          </div>
          <h2 className="mt-1 text-xl font-bold leading-[1.2] text-[var(--color-text-primary)]">
            {reference}
          </h2>
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {noteCount === 1 ? '1 note' : `${noteCount} notes`}
            {' · '}
            {references.length === 1 ? '1 reference' : `${references.length} references`}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {passageUrl && (
              <a
                href={passageUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-[var(--color-accent-link)] underline"
              >
                Open passage
              </a>
            )}
            <span className="flex-1" />
            {previous?.id && (
              <Button
                variant="ghost"
                onClick={() => { if (onOpenChapter && previous.id) void onOpenChapter(previous.id) }}
                disabled={!onOpenChapter}
                className="h-auto rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2.5 py-1 text-xs"
              >
                <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                {previous.reference}
              </Button>
            )}
            {next?.id && (
              <Button
                variant="ghost"
                onClick={() => { if (onOpenChapter && next.id) void onOpenChapter(next.id) }}
                disabled={!onOpenChapter}
                className="h-auto rounded-[10px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-2.5 py-1 text-xs"
              >
                {next.reference}
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className={flatTop
          ? 'min-h-0 flex-1 overflow-auto border-t border-[var(--color-border-subtle)] px-6 pb-6 pt-6'
          : 'min-h-0 flex-1 overflow-auto border-t border-[var(--color-border-subtle)] pt-6'}
        >
          <p className="mb-3 block text-xs font-bold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
            Citations by verse
          </p>

          {references.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-disabled)]">None</p>
          ) : (
            <div className="space-y-5">
              {references.map((entry) => (
                <div key={entry.id}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {verseSpanLabel(entry.verseStart, entry.verseEnd)}
                    </span>
                    <span className="text-xs text-[var(--color-text-disabled)]">
                      {entry.reference}
                      {' · '}
                      {entry.noteCount === 1 ? '1 note' : `${entry.noteCount} notes`}
                    </span>
                    {entry.passageUrl && (
                      <a
                        href={entry.passageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--color-accent-link)] underline"
                      >
                        passage
                      </a>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {(entry.linkedNotes ?? []).map((note) => {
                      const target = toTarget(note)
                      return (
                        <Button
                          key={`${entry.id}:${note.id}`}
                          onClick={(event: React.MouseEvent) => {
                            if (!target || !onNavigateToObject) return
                            void onNavigateToObject(target, { forceNewTab: event.metaKey || event.ctrlKey })
                          }}
                          disabled={Boolean(!target || !onNavigateToObject)}
                          variant="ghost"
                          className="h-auto w-full justify-start rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-control)] px-3 py-2 text-left"
                        >
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                            <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                              {noteLabel(note)}
                            </span>
                            <span className="truncate text-xs uppercase tracking-[0.08em] text-[var(--color-text-disabled)]">
                              {String(note.type ?? '').replace(/-/g, ' ') || 'note'}
                            </span>
                          </span>
                        </Button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
