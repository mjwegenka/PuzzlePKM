import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { DailyNote } from '../shared/types'
import NoteEditor from '../components/editor/NoteEditor'
import TagInput from '../components/TagInput'
import { useNotesStore } from '../store/notesStore'
import { getTodayDate, formatDateHeading, prevDay, nextDay } from '../lib/dateUtils'
import { Button } from '../components/ui/button'
import { useTagDetection } from '../hooks/useTagDetection'

export default function DailyNotePage() {
  const { date } = useParams<{ date: string }>()
  const navigate = useNavigate()
  const currentDate = date ?? getTodayDate()

  const { setCurrentDailyNote, updateDailyNoteInList } = useNotesStore()

  const [note, setNote] = useState<DailyNote | null>(null)
  const [content, setContent] = useState<object>({})
  const [contentMarkdown, setContentMarkdown] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef({ content, contentMarkdown, tags })
  const noteRef = useRef<DailyNote | null>(null)

  useEffect(() => {
    const loadNote = async () => {
      setIsLoading(true)
      setNote(null)
      setContent({})
      setContentMarkdown('')
      setTags([])

      const res = await window.dropith.dailyNote.upsert({
        id: crypto.randomUUID(),
        date: currentDate,
        now: new Date().toISOString(),
      })

      if (res.success && res.data) {
        setNote(res.data)
        noteRef.current = res.data
        setContent(res.data.content)
        setContentMarkdown(res.data.contentMarkdown)
        setTags(res.data.tags)
        setCurrentDailyNote(res.data)
      }
      setIsLoading(false)
    }

    loadNote()
  }, [currentDate, setCurrentDailyNote])

  pendingRef.current = { content, contentMarkdown, tags }

  const save = useCallback(async () => {
    const { content: c, contentMarkdown: md, tags: tg } = pendingRef.current
    const now = new Date().toISOString()
    if (!noteRef.current) return

    setIsSaving(true)
    try {
      const res = await window.dropith.dailyNote.upsert({
        id: noteRef.current.id,
        date: currentDate,
        content: c,
        contentMarkdown: md,
        tags: tg,
        now,
      })
      if (res.success && res.data) {
        setNote(res.data)
        noteRef.current = res.data
        updateDailyNoteInList(res.data)
        setLastSaved(new Date())
      }
    } finally {
      setIsSaving(false)
    }
  }, [currentDate, updateDailyNoteInList])

  useEffect(() => {
    const off = window.dropith.onMenuEvent('menu:save', () => save())
    return () => off()
  }, [save])

  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => save(), 1000)
  }, [save])

  const handleContentChange = (c: object, md: string) => {
    setContent(c)
    setContentMarkdown(md)
    scheduleAutosave()
  }

  const handleTagsChange = (newTags: string[]) => {
    setTags(newTags)
    scheduleAutosave()
  }

  const handleTagDetected = useTagDetection(setTags, pendingRef, scheduleAutosave)

  const today = getTodayDate()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-10 pt-10 pb-0">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(`/daily/${prevDay(currentDate)}`)} title="Previous day">
            ←
          </Button>
          <h1 className="text-4xl font-bold text-[#f2f2f2] tracking-tight">
            {formatDateHeading(currentDate)}
          </h1>
          <Button variant="ghost" size="icon" onClick={() => navigate(`/daily/${nextDay(currentDate)}`)} title="Next day">
            →
          </Button>
          {currentDate !== today && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/daily/${today}`)}>
              Today
            </Button>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="px-10 py-3">
        <TagInput value={tags} onChange={handleTagsChange} />
      </div>

      {/* Save status */}
      <div className="px-10 pb-2 flex items-center gap-2 text-xs text-[#5a5a5a]">
        {isSaving && <span>Saving…</span>}
        {!isSaving && lastSaved && <span>Saved {lastSaved.toLocaleTimeString()}</span>}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[#8a8a8a]">Loading…</span>
          </div>
        ) : (
          <NoteEditor
            key={note?.id ?? currentDate}
            content={content}
            onChange={handleContentChange}
            onTagDetected={handleTagDetected}
            placeholder="What happened today?"
          />
        )}
      </div>
    </div>
  )
}
