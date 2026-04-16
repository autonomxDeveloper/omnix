import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  activeModal: ActiveModal
  // actions
  setTheme: (theme: 'dark' | 'light') => void
  toggleTheme: () => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  openModal: (modal: ActiveModal) => void
  closeModal: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarOpen: false,
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
