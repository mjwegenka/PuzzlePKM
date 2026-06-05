import { create } from 'zustand'

interface UnsavedChangesState {
  dirtySources: Set<string>
  setDirty: (source: string, isDirty: boolean) => void
  hasUnsavedChanges: () => boolean
  showCloseConfirm: boolean
  setShowCloseConfirm: (show: boolean) => void
}

export const useUnsavedChangesStore = create<UnsavedChangesState>((set, get) => ({
  dirtySources: new Set<string>(),
  setDirty: (source, isDirty) => set((state) => {
    const newSet = new Set(state.dirtySources)
    if (isDirty) {
      newSet.add(source)
    } else {
      newSet.delete(source)
    }
    return { dirtySources: newSet }
  }),
  hasUnsavedChanges: () => get().dirtySources.size > 0,
  showCloseConfirm: false,
  setShowCloseConfirm: (show) => set({ showCloseConfirm: show })
}))
