import { create } from 'zustand'
import type { TopicNote, DailyNote, Tag } from '../shared/types'

interface NotesState {
  topicNotes: TopicNote[]
  dailyNotes: DailyNote[]
  tags: Tag[]
  isLoadingTopicNotes: boolean
  isLoadingDailyNote: boolean
  currentTopicNote: TopicNote | null
  currentDailyNote: DailyNote | null
  setTopicNotes: (notes: TopicNote[]) => void
  setDailyNotes: (notes: DailyNote[]) => void
  setTags: (tags: Tag[]) => void
  setCurrentTopicNote: (note: TopicNote | null) => void
  setCurrentDailyNote: (note: DailyNote | null) => void
  setLoadingTopicNotes: (v: boolean) => void
  setLoadingDailyNote: (v: boolean) => void
  updateTopicNoteInList: (note: TopicNote) => void
  updateDailyNoteInList: (note: DailyNote) => void
  addTag: (tag: Tag) => void
}

export const useNotesStore = create<NotesState>((set) => ({
  topicNotes: [],
  dailyNotes: [],
  tags: [],
  isLoadingTopicNotes: false,
  isLoadingDailyNote: false,
  currentTopicNote: null,
  currentDailyNote: null,

  setTopicNotes: (notes) => set({ topicNotes: notes }),
  setDailyNotes: (notes) => set({ dailyNotes: notes }),
  setTags: (tags) => set({ tags }),
  setCurrentTopicNote: (note) => set({ currentTopicNote: note }),
  setCurrentDailyNote: (note) => set({ currentDailyNote: note }),
  setLoadingTopicNotes: (v) => set({ isLoadingTopicNotes: v }),
  setLoadingDailyNote: (v) => set({ isLoadingDailyNote: v }),
  updateTopicNoteInList: (note) =>
    set((state) => ({
      topicNotes: state.topicNotes.map((n) => (n.id === note.id ? note : n)),
    })),
  updateDailyNoteInList: (note) =>
    set((state) => ({
      dailyNotes: state.dailyNotes.map((n) => (n.id === note.id ? note : n)),
    })),
  addTag: (tag) =>
    set((state) => ({
      tags: state.tags.find((t) => t.id === tag.id)
        ? state.tags
        : [...state.tags, tag].sort((a, b) => a.name.localeCompare(b.name)),
    })),
}))
