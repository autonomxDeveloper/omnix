import { useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useSession } from '@/hooks/use-sessions'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { WelcomeScreen } from './WelcomeScreen'

export function ChatView() {
  const { activeSessionId, messages, isStreaming, streamingContent } = useChatStore()
  const { data: session } = useSession(activeSessionId)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load session messages when active session changes
  const setMessages = useChatStore((s) => s.setMessages)
  useEffect(() => {
    if (session?.messages) {
      setMessages(session.messages)
    }
  }, [session, setMessages])

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingContent])

  const hasMessages = messages.length > 0 || isStreaming

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {hasMessages ? (
          <MessageList
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
          />
        ) : (
          <WelcomeScreen />
        )}
      </div>

      {/* Input area */}
      <ChatInput />
    </div>
  )
}
