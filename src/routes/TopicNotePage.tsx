import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { TopicNote, Link } from '../shared/types'
import NoteEditor from '../components/editor/NoteEditor'
import TagInput from '../components/TagInput'
import { useNotesStore } from '../store/notesStore'
import { Button } from '../components/ui/button'
import { Trash2 } from 'lucide-react'
import { useTagDetection } from '../hooks/useTagDetection'

export default function TopicNotePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const { setCurrentTopicNote, updateTopicNoteInList, topicNotes, setTopicNotes } = useNotesStore()

  const [note, setNote] = useState<TopicNote | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState<object>({})
  const [contentMarkdown, setContentMarkdown] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [backlinks, setBacklinks] = useState<Link[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(!isNew)

  const noteIdRef = useRef<string>(isNew ? crypto.randomUUID() : (id ?? ''))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef({ title, content, contentMarkdown, tags })

  // Load existing note
  useEffect(() => {
    if (isNew) { setIsLoading(false); return }
    const loadNote = async () => {
      setIsLoading(true)
      const res = await window.dropith.topicNote.get(id!)
      if (res.success && res.data) {
        setNote(res.data)
        setTitle(res.data.title)
        setContent(res.data.content)
        setContentMarkdown(res.data.contentMarkdown)
        setTags(res.data.tags)
        setCurrentTopicNote(res.data)

        const linksRes = await window.dropith.link.getForObject(id!)
        if (linksRes.success && linksRes.data) {
          setBacklinks(linksRes.data.filter((l: import('../shared/types').Link) => l.targetId === id))
        }
      }
      setIsLoading(false)
    }
    loadNote()
  }, [id, isNew, setCurrentTopicNote])

  pendingRef.current = { title, content, contentMarkdown, tags }

  const save = useCallback(async (force = false) => {
    if (!force && debounceRef.current) return
    const { title: t, content: c, contentMarkdown: md, tags: tg } = pendingRef.current
    const now = new Date().toISOString()
    const noteId = noteIdRef.current
    setIsSaving(true)

    try {
      if (isNew && !note) {
        const res = await window.dropith.topicNote.create({
          id: noteId,
          title: t,
          content: c,
          contentMarkdown: md,
          linkedObjectIds: [],
          tags: tg,
          createdAt: now,
          updatedAt: now,
        })
        if (res.success && res.data) {
          setNote(res.data)
          setTopicNotes([res.data, ...topicNotes])
          navigate(`/topic/${noteId}`, { replace: true })
        }
      } else {
        const res = await window.dropith.topicNote.update(note?.id ?? noteId, {
          title: t,
          content: c,
          contentMarkdown: md,
          tags: tg,
          updatedAt: now,
        })
        if (res.success && res.data) {
          setNote(res.data)
          updateTopicNoteInList(res.data)
        }
      }
      setLastSaved(new Date())
    } finally {
      setIsSaving(false)
    }
  }, [isNew, navigate, note, setTopicNotes, topicNotes, updateTopicNoteInList])

  // Keyboard shortcuts
  useEffect(() => {
    const off = window.dropith.onMenuEvent('menu:save', () => save(true))
    const offNew = window.dropith.onMenuEvent('menu:new-note', () => navigate('/topic/new'))
    return () => { off(); offNew() }
  }, [navigate, save])

  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { save() }, 1000)
  }, [save])

  const handleContentChange = (c: object, md: string) => {
    setContent(c)
    setContentMarkdown(md)
    scheduleAutosave()
  }

  const handleTitleChange = (v: string) => {
    setTitle(v)
    scheduleAutosave()
  }

  const handleTagsChange = (newTags: string[]) => {
    setTags(newTags)
    scheduleAutosave()
  }

  const handleTagDetected = useTagDetection(setTags, pendingRef, scheduleAutosave)

  const handleDelete = async () => {
    if (!note) return
    if (!window.confirm('Delete this note?')) return
    await window.dropith.topicNote.delete(note.id)
    setTopicNotes(topicNotes.filter((n) => n.id !== note.id))
    navigate('/topic/new', { replace: true })
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <span className="text-[#8a8a8a]">Loading…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title row with delete */}
      <div className="px-10 pt-10 pb-0 flex items-start gap-3">
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          className="flex-1 text-4xl font-bold text-[#f2f2f2] bg-transparent border-none outline-none placeholder:text-[#3a3a3a] tracking-tight"
        />
        {note && (
          <Button variant="destructive" size="icon" onClick={handleDelete} title="Delete note" aria-label="Delete note" className="mt-2 flex-shrink-0">
            <Trash2 size={15} />
          </Button>
        )}
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
        <NoteEditor
          content={content}
          onChange={handleContentChange}
          onTagDetected={handleTagDetected}
          placeholder="Start writing your note…"
        />
      </div>

      {/* Backlinks */}
      {backlinks.length > 0 && (
        <div className="border-t border-[#262626] px-8 py-4">
          <h3 className="text-xs font-semibold text-[#6a6a6a] uppercase tracking-wider mb-3">Backlinks</h3>
          <div className="space-y-1">
            {backlinks.map((link) => (
              <BacklinkItem key={link.id} link={link} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BacklinkItem({ link }: { link: Link }) {
  const navigate = useNavigate()
  const { topicNotes } = useNotesStore()
  const sourceNote = topicNotes.find((n) => n.id === link.sourceId)

  return (
    <button
      onClick={() => navigate(`/topic/${link.sourceId}`)}
      className="flex items-center gap-2 text-sm text-[#6b9fd4] hover:underline"
    >
      ← {sourceNote?.title ?? link.sourceId}
    </button>
  )
}
