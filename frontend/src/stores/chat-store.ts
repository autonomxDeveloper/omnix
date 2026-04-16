import { create } from 'zustand'

/**
 * Chat store: owns ONLY ephemeral streaming/interaction state.
 * Server-fetched data (sessions, messages) lives in TanStack Query.
 * This store tracks the active streaming state and token counters.
 */
interface ChatState {
  isStreaming: boolean
  streamingContent: string
  /** Optimistic messages added during streaming before query refetch */
  pendingUserMessage: string | null
  inputTokens: number
  outputTokens: number

  // actions
  setStreaming: (streaming: boolean) => void
  appendStreamContent: (chunk: string) => void
  clearStreamContent: () => void
  setPendingUserMessage: (message: string | null) => void
  setTokenCounts: (input: number, output: number) => void
  reset: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  isStreaming: false,
  streamingContent: '',
  pendingUserMessage: null,
  inputTokens: 0,
  outputTokens: 0,

  setStreaming: (streaming) => set({ isStreaming: streaming }),
  appendStreamContent: (chunk) =>
    set((s) => ({ streamingContent: s.streamingContent + chunk })),
  clearStreamContent: () => set({ streamingContent: '' }),
  setPendingUserMessage: (message) => set({ pendingUserMessage: message }),
  setTokenCounts: (input, output) => set({ inputTokens: input, outputTokens: output }),
  reset: () => set({
    isStreaming: false,
    streamingContent: '',
    pendingUserMessage: null,
  }),
}))
