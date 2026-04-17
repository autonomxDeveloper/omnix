import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import { useAudioPlayer } from '@/hooks/use-audio-player'
import type { ChatMessage } from '@/types/chat'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
}

export function MessageList({ messages, isStreaming, streamingContent }: MessageListProps) {
  const audioPlayer = useAudioPlayer()
  
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-8">
      {messages.map((msg, i) => (
        <MessageBubble 
          key={i} 
          message={msg}
          messageId={String(i)}
          audioPlayer={audioPlayer}
        />
      ))}
      {isStreaming && streamingContent && (
        <MessageBubble
          message={{ role: 'assistant', content: streamingContent }}
          streaming
          messageId="streaming"
          audioPlayer={audioPlayer}
        />
      )}
      {isStreaming && !streamingContent && <TypingIndicator />}
    </div>
  )
}
