import { useRef, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useChatStore } from '@/stores/chat-store'
import { useSession, useCreateSession } from '@/hooks/use-sessions'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { WelcomeScreen } from './WelcomeScreen'

export function ChatView() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { isStreaming, streamingContent, pendingUserMessage } = useChatStore()
  const { data: session, refetch } = useSession(sessionId || null)
  const createSession = useCreateSession()
  const scrollRef = useRef<HTMLDivElement>(null)
  const creatingRef = useRef(false)

  // Create empty session when landing on /chat without id
  useEffect(() => {
    if (!sessionId && !creatingRef.current) {
      creatingRef.current = true
      createSession.mutate(undefined, {
        onSuccess: (session) => {
          if (session && session.id) {
            navigate(`/chat/${session.id}`, { replace: true })
          }
          creatingRef.current = false
        },
        onError: () => {
          creatingRef.current = false
        }
      })
    }
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch session data when sessionId changes
  useEffect(() => {
    if (sessionId) {
      refetch()
    }
  }, [sessionId, refetch])

  // Messages come from TanStack Query (server-state owner), not Zustand
  const serverMessages = session?.messages || []

  // Derive the displayed messages: server messages + any optimistic pending user message
  const displayMessages = pendingUserMessage
    ? [...serverMessages, { role: 'user' as const, content: pendingUserMessage }]
    : serverMessages

  const hasMessages = displayMessages.length > 0 || isStreaming

  // Auto-scroll on new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayMessages, streamingContent])

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {hasMessages ? (
          <MessageList
            messages={displayMessages}
            isStreaming={isStreaming}
            streamingContent={streamingContent}
          />
        ) : (
          <WelcomeScreen />
        )}
      </div>

      {/* Input area */}
      <ChatInput sessionId={sessionId || null} />
    </div>
  )
}
