import { useCallback, useRef } from 'react'
import { useNotesStore } from '../store/notesStore'

/**
 * Returns a stable `handleTagDetected` callback that creates or looks up a tag
 * by name and appends it to the object's tag list, then triggers autosave.
 */
export function useTagDetection(
  setTags: React.Dispatch<React.SetStateAction<string[]>>,
  pendingRef: React.MutableRefObject<{ tags: string[] } & Record<string, unknown>>,
  scheduleAutosave: () => void,
) {
  // Capture a ref to the store's getState so we always access the latest state
  // without needing it as a useCallback dependency.
  const getStoreState = useRef(useNotesStore.getState).current

  return useCallback(async (tagName: string) => {
    const { tags: allTags } = getStoreState()
    const normalized = tagName.toLowerCase()
    let tagId: string | null = null

    const existing = allTags.find((t) => t.name === normalized)
    if (existing) {
      tagId = existing.id
    } else {
      const result = await window.dropith.tag.create({
        id: crypto.randomUUID(),
        displayName: tagName,
        createdAt: new Date().toISOString(),
      })
      if (result.success && result.data) {
        getStoreState().addTag(result.data)
        tagId = result.data.id
      }
    }

    if (tagId) {
      setTags((prev) => {
        if (prev.includes(tagId!)) return prev
        const next = [...prev, tagId!]
        pendingRef.current = { ...pendingRef.current, tags: next }
        scheduleAutosave()
        return next
      })
    }
  }, [getStoreState, setTags, pendingRef, scheduleAutosave])
}
