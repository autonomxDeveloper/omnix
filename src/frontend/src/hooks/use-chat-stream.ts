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
export function useChatStream(
  sessionId: string | null,
  onSessionCreated?: (sessionId: string) => void,
) {
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
      if (!text.trim() || abortRef.current) return
      
      // Optimistic: show user message in UI immediately
      setPendingUserMessage(text)
      clearStreamContent()

      const abort = new AbortController()
      abortRef.current = abort
      let ai_message = ''

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

        // Only set streaming after successful stream establishment
        setStreaming(true)

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
                ai_message += parsed.content
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
              ai_message += data
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Chat stream error:', err)
        }
      } finally {
        console.log('✅ Chat stream completed')
        console.log('📌 Stream complete. Current sessionId:', sessionId)
        setStreaming(false)
        clearStreamContent()
        abortRef.current = null
        
         // Wait for backend to persist session before invalidating
         setTimeout(async () => {
           console.log('🔄 Refreshing session data...')
           
           // Always refetch sessions list first
           await queryClient.refetchQueries({ queryKey: ['sessions'], exact: true })
           const sessions = queryClient.getQueryData(['sessions']) as any[]
           console.log('📌 Got sessions list:', sessions?.length || 0, 'sessions')
           if (sessions) console.log('📌 Latest session:', sessions[0])
           
           // AFTER sessions list is refreshed, find the new session id
            if (sessions && sessions.length > 0 && !sessionId) {
              // This was a new chat - use the already created session
              const latestSession = sessions[0]
              
              // Manually add the new messages directly to cache to avoid refetch delay
              queryClient.setQueryData(['session', latestSession.id], {
                id: latestSession.id,
                title: latestSession.title,
                messages: [
                  { role: 'user', content: text },
                  { role: 'assistant', content: ai_message }
                ]
              })
              
              onSessionCreated?.(latestSession.id)
              console.log(`✅ Navigated to new session: ${latestSession.id}`)
              console.log('✅ Updated session cache directly')
            }
          
          // Refetch session if we had an existing id
          if (sessionId) {
            await queryClient.refetchQueries({ queryKey: ['session', sessionId], exact: true })
            console.log('✅ Existing session data refreshed')
          }
          
          // Clear pending user message ONLY after queries are updated AND navigation is done
          setTimeout(() => {
            setPendingUserMessage(null)
            console.log('✅ Pending message cleared')
          }, 200)
        }, 500)
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
      onSessionCreated,
    ],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { send, abort }
}