import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Volume2, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSpeak } from '@/hooks/use-tts'
import type { ChatMessage } from '@/types/chat'
import type { useAudioPlayer } from '@/hooks/use-audio-player'

interface MessageBubbleProps {
  message: ChatMessage
  streaming?: boolean
  messageId: string
  audioPlayer: ReturnType<typeof useAudioPlayer>
}

export function MessageBubble({ message, streaming, messageId, audioPlayer }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const speak = useSpeak()
  
  const isCurrentlyPlaying = audioPlayer.currentPlayingId === messageId
  
  const handleSpeak = async () => {
    if (isCurrentlyPlaying) {
      audioPlayer.stop()
      return
    }
    
    try {
      const result = await speak.mutateAsync(message.content)
      audioPlayer.play(result.audio, messageId, result.sample_rate)
    } catch (e) {
      console.error('Failed to speak:', e)
    }
  }

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white',
        )}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Content */}
      <div className="flex gap-2 items-end">
        {!isUser && !streaming && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 mb-2"
            onClick={handleSpeak}
            disabled={speak.isPending}
          >
            {isCurrentlyPlaying ? (
              <Square className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        )}
        
        <div
          className={cn(
            'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground',
            streaming && 'animate-pulse-subtle',
          )}
        >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: ({ children }) => (
                  <pre className="rounded-lg bg-background/50 p-3 overflow-x-auto text-xs">
                    {children}
                  </pre>
                ),
                code: ({ children, className }) => {
                  const isInline = !className
                  return isInline ? (
                    <code className="rounded bg-background/50 px-1.5 py-0.5 text-xs font-mono">
                      {children}
                    </code>
                  ) : (
                    <code className={cn('text-xs font-mono', className)}>{children}</code>
                  )
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
         {streaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      </div>
    </div>
  )
}
