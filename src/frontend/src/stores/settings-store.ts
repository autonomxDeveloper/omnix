import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Provider, Settings } from '@/types/settings'

interface SettingsState {
  settings: Settings
  setSettings: (settings: Partial<Settings>) => void
  setProvider: (provider: Provider) => void
  setModel: (model: string) => void
  setSystemPrompt: (prompt: string) => void
  setSelectedVoice: (voice: string) => void
  setAutoSpeak: (enabled: boolean) => void
  setTtsEnabled: (enabled: boolean) => void
}

const defaultSettings: Settings = {
  provider: 'lmstudio',
  temperature: 0.7,
  max_tokens: 2048,
  context_length: 4096,
  system_prompt: 'You are a helpful conversational AI assistant.',
  tts_enabled: false,
  stt_enabled: false,
  selected_voice: 'default',
  auto_speak: false,
}

export const useSettingsStore = create<SettingsState & { _hasHydrated: boolean }>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      _hasHydrated: false,
      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
      setProvider: (provider) =>
        set((s) => ({ settings: { ...s.settings, provider } })),
      setModel: (model) =>
        set((s) => ({ settings: { ...s.settings, model } })),
      setSystemPrompt: (system_prompt) =>
        set((s) => ({ settings: { ...s.settings, system_prompt } })),
      setSelectedVoice: (selected_voice) =>
        set((s) => ({ settings: { ...s.settings, selected_voice } })),
      setAutoSpeak: (auto_speak) =>
        set((s) => ({ settings: { ...s.settings, auto_speak } })),
      setTtsEnabled: (tts_enabled) =>
        set((s) => ({ settings: { ...s.settings, tts_enabled } })),
    }),
    {
      name: 'omnix-settings',
      partialize: (state) => ({ settings: state.settings }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state._hasHydrated = true
        }
      },
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          return JSON.parse(str)
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value))
        },
        removeItem: (name) => {
          localStorage.removeItem(name)
        },
      },
    },
  ),
)
