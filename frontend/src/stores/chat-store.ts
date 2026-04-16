import { create } from 'zustand'
import type { ChatMessage, ChatSession } from '@/types/chat'

interface ChatState {
  sessions: ChatSession[]
  activeSessionId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  inputTokens: number
  outputTokens: number

  // actions
  setSessions: (sessions: ChatSession[]) => void
  setActiveSession: (id: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  setStreaming: (streaming: boolean) => void
  appendStreamContent: (chunk: string) => void
  clearStreamContent: () => void
  setTokenCounts: (input: number, output: number) => void
  clearChat: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  inputTokens: 0,
  outputTokens: 0,

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  clearStreamContent: () => set({ streamingContent: '' }),
  setTokenCounts: (input, output) => set({ inputTokens: input, outputTokens: output }),
  clearChat: () => set({ messages: [], streamingContent: '', activeSessionId: null }),
}))
