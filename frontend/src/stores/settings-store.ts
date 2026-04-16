import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Provider, Settings } from '@/types/settings'

interface SettingsState {
  settings: Settings
  setSettings: (settings: Partial<Settings>) => void
  setProvider: (provider: Provider) => void
  setModel: (model: string) => void
  setSystemPrompt: (prompt: string) => void
}

const defaultSettings: Settings = {
  provider: 'lmstudio',
  temperature: 0.7,
  max_tokens: 2048,
  context_length: 4096,
  system_prompt: 'You are a helpful conversational AI assistant.',
  tts_enabled: false,
  stt_enabled: false,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      setSettings: (partial) =>
        set((s) => ({ settings: { ...s.settings, ...partial } })),
      setProvider: (provider) =>
        set((s) => ({ settings: { ...s.settings, provider } })),
      setModel: (model) =>
        set((s) => ({ settings: { ...s.settings, model } })),
      setSystemPrompt: (system_prompt) =>
        set((s) => ({ settings: { ...s.settings, system_prompt } })),
    }),
    {
      name: 'omnix-settings',
      partialize: (state) => ({ settings: state.settings }),
    },
  ),
)
