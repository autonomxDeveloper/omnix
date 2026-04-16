import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppMode = 'chat' | 'rpg'
export type ActiveModal =
  | null
  | 'settings'
  | 'history'
  | 'search'
  | 'audiobook'
  | 'podcast'
  | 'story'
  | 'voice-studio'
  | 'voice-clone'
  | 'character-sheet'

interface AppState {
  theme: 'dark' | 'light'
  sidebarOpen: boolean
  mode: AppMode
  activeModal: ActiveModal
  // actions
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setMode: (mode: AppMode) => void
  openModal: (modal: ActiveModal) => void
  closeModal: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarOpen: false,
      mode: 'chat',
      activeModal: null,

      setTheme: (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark')
        set({ theme })
      },
      toggleTheme: () =>
        set((s) => {
          const theme = s.theme === 'dark' ? 'light' : 'dark'
          document.documentElement.classList.toggle('dark', theme === 'dark')
          return { theme }
        }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setMode: (mode) => set({ mode }),
      openModal: (modal) => set({ activeModal: modal }),
      closeModal: () => set({ activeModal: null }),
    }),
    {
      name: 'omnix-app',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
      }),
    },
  ),
)
