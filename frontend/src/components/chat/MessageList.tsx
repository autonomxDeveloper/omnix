import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import type { ChatMessage } from '@/types/chat'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
}

export function MessageList({ messages, isStreaming, streamingContent }: MessageListProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: 'assistant', content: streamingContent }}
          streaming
        />
      )}
      {isStreaming && !streamingContent && <TypingIndicator />}
    </div>
  )
}
