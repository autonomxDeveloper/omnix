import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/types/chat'

interface MessageBubbleProps {
  message: ChatMessage
  streaming?: boolean
}

export function MessageBubble({ message, streaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

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
  )
}
