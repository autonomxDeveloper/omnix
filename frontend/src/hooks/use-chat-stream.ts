import { useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/stores/chat-store'
import { useSettingsStore } from '@/stores/settings-store'
import { chatApi } from '@/api/endpoints/chat'
import type { StreamChunk } from '@/types/chat'

/**
 * Centralized chat streaming hook.
 * Owns the entire streaming transport lifecycle: connect, parse SSE lines,
 * update ephemeral Zustand state, and refetch TanStack Query on completion.
 *
 * State ownership:
 *   - TanStack Query: session data, message history (refetched on stream end)
 *   - Zustand (chat-store): isStreaming, streamingContent, pendingUserMessage, tokens
 *   - This hook: AbortController, SSE line parser, chunk accumulation
 */
export function useChatStream(sessionId: string | null) {
  const queryClient = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)
  const { settings } = useSettingsStore()
  const {
    setStreaming,
    appendStreamContent,
    clearStreamContent,
    setPendingUserMessage,
    setTokenCounts,
  } = useChatStore()

  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return

      // Optimistic: show user message in UI immediately
      setPendingUserMessage(text)
      setStreaming(true)
      clearStreamContent()

      const abort = new AbortController()
      abortRef.current = abort

      try {
        const stream = await chatApi.streamChat(
          {
            message: text,
            session_id: sessionId || undefined,
            system_prompt: settings.system_prompt,
            model: settings.model,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
          },
          abort.signal,
        )

        if (!stream) return

        const reader = stream.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed: StreamChunk = JSON.parse(data)
              if (parsed.content) {
                appendStreamContent(parsed.content)
              }
              if (parsed.usage) {
                setTokenCounts(
                  parsed.usage.prompt_tokens,
                  parsed.usage.completion_tokens,
                )
              }
            } catch {
              // Plain text chunk fallback
              appendStreamContent(data)
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Chat stream error:', err)
        }
      } finally {
        setStreaming(false)
        clearStreamContent()
        setPendingUserMessage(null)
        abortRef.current = null
        // Refetch session data so TanStack Query has the full conversation
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
        }
        queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }
    },
    [
      sessionId,
      settings,
      queryClient,
      setStreaming,
      appendStreamContent,
      clearStreamContent,
      setPendingUserMessage,
      setTokenCounts,
    ],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, abort }
}
