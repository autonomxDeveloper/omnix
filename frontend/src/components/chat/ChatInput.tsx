import { useState, useRef, useCallback } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useSettingsStore } from '@/stores/settings-store'
import { chatApi } from '@/api/endpoints/chat'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Paperclip } from 'lucide-react'

export function ChatInput() {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { activeSessionId, isStreaming, addMessage, setStreaming, appendStreamContent, clearStreamContent, setTokenCounts } = useChatStore()
  const { settings } = useSettingsStore()

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    addMessage({ role: 'user', content: text })
    setStreaming(true)
    clearStreamContent()

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const stream = await chatApi.streamChat(
        {
          message: text,
          session_id: activeSessionId || undefined,
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
      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        // Parse SSE data lines
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.content) {
                fullResponse += parsed.content
                appendStreamContent(parsed.content)
              }
              if (parsed.usage) {
                setTokenCounts(parsed.usage.prompt_tokens, parsed.usage.completion_tokens)
              }
            } catch {
              // Plain text chunk
              fullResponse += data
              appendStreamContent(data)
            }
          }
        }
      }

      // Add final assistant message
      if (fullResponse) {
        addMessage({ role: 'assistant', content: fullResponse })
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addMessage({
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
        })
      }
    } finally {
      setStreaming(false)
      clearStreamContent()
      abortRef.current = null
    }
  }, [input, isStreaming, activeSessionId, settings, addMessage, setStreaming, appendStreamContent, clearStreamContent, setTokenCounts])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border bg-background p-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative flex items-end gap-2 rounded-xl border border-input bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="min-h-[40px] max-h-[200px] flex-1 resize-none border-0 bg-transparent p-1 text-sm shadow-none focus-visible:ring-0"
            rows={1}
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={!input.trim() || isStreaming}
            onClick={handleSend}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
