import React, { useState } from 'react'
import { CalendarDays, NotebookPen, Repeat2 } from 'lucide-react'
import ObjectEditor from '../objects/ObjectEditor'
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs'
import { getTodayDate } from '../../lib/dateUtils'

type NoteType = 'topic-note' | 'daily-note' | 'habit'

interface NewNotePageProps {
  onSaved?: () => void
}

export default function NewNotePage({ onSaved }: NewNotePageProps) {
  const [noteType, setNoteType] = useState<NoteType>('topic-note')
  const [editorKey, setEditorKey] = useState(0) // force re-mount on type change

  const handleTypeChange = (value: string) => {
    setNoteType(value as NoteType)
    setEditorKey((k) => k + 1)
  }

  const blankObject =
    noteType === 'daily-note'
      ? { date: getTodayDate(), contentMarkdown: '', tags: [], linkedObjectIds: [] }
      : noteType === 'topic-note'
        ? { title: '', date: '', contentMarkdown: '', tags: [], linkedObjectIds: [] }
        : { date: getTodayDate(), contentMarkdown: '', tags: [] }

  const handleSave = (saved: Record<string, unknown>) => {
    // Reset editor to a fresh blank form after save
    void saved
    setEditorKey((k) => k + 1)
    onSaved?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3">
        <NotebookPen className="h-7 w-7 text-[var(--color-accent-selected)]" />
        <div>
          <h1 className="text-lg font-bold leading-tight text-[var(--color-text-primary)]">
            New Note
          </h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Create a new note in your knowledge base
          </p>
        </div>
      </div>

      {/* Type switcher */}
      <section className="shrink-0 rounded-[14px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] p-4">
        <p className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
          Note type
        </p>
        <Tabs value={noteType} onValueChange={handleTypeChange}>
          <TabsList className="grid h-10 w-full max-w-lg grid-cols-3 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-1 text-[var(--color-text-disabled)]">
            <TabsTrigger value="topic-note" className="gap-2 rounded-[10px] px-3 text-xs data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <NotebookPen className="h-4 w-4" />
              Topic Note
            </TabsTrigger>
            <TabsTrigger value="daily-note" className="gap-2 rounded-[10px] px-3 text-xs data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <CalendarDays className="h-4 w-4" />
              Daily Note
            </TabsTrigger>
            <TabsTrigger value="habit" className="gap-2 rounded-[10px] px-3 text-xs data-[state=active]:bg-[var(--color-selected-fill-soft)] data-[state=active]:text-[var(--color-text-primary)]">
              <Repeat2 className="h-4 w-4" />
              Habit
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Hint text per type */}
        <p className="mt-1.5 block text-xs text-[var(--color-text-disabled)]">
          {noteType === 'topic-note'
            ? 'Topic notes are titled notes on any subject. They can link to other objects using @mentions.'
            : noteType === 'daily-note'
              ? 'Daily notes are journal entries tied to a specific date. Each date has one daily note.'
              : 'Habits are date-scoped tracking notes for routines and repeat actions.'}
        </p>
      </section>

      {/* Editor */}
      <div className="flex min-h-0 flex-1">
        <ObjectEditor
          key={editorKey}
          object={blankObject}
          type={noteType}
          onSave={handleSave}
        />
      </div>
    </div>
  )
}
