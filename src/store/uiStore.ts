import { create } from 'zustand'
import type { DropboxAuthState, SyncStatus } from '../shared/types'

interface UIState {
  isSearchOpen: boolean
  isSidebarCollapsed: boolean
  authState: DropboxAuthState
  syncStatus: SyncStatus
  setSearchOpen: (v: boolean) => void
  toggleSidebar: () => void
  setAuthState: (state: DropboxAuthState) => void
  setSyncStatus: (status: SyncStatus) => void
}

export const useUIStore = create<UIState>((set) => ({
  isSearchOpen: false,
  isSidebarCollapsed: false,
  authState: { isConnected: false, isConfigured: false },
  syncStatus: { isSyncing: false },

  setSearchOpen: (v) => set({ isSearchOpen: v }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setAuthState: (authState) => set({ authState }),
  setSyncStatus: (syncStatus) => set({ syncStatus }),
}))
