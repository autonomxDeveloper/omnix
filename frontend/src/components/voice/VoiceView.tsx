import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Mic, MicOff, Volume2, VolumeX, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VoiceMessage } from '@/types/voice'

/**
 * Voice conversation mode - full-page voice interaction UI.
 * Uses WebSocket for STT and TTS streaming.
 */
export function VoiceView() {
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [autoListen, setAutoListen] = useState(true)
  const [transcript, setTranscript] = useState('')
  const [messages, setMessages] = useState<VoiceMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const toggleListening = useCallback(() => {
    setIsListening((prev) => !prev)
  }, [])

  const toggleAutoListen = useCallback(() => {
    setAutoListen((prev) => !prev)
  }, [])

  const stopAll = useCallback(() => {
    setIsListening(false)
    setIsSpeaking(false)
    setTranscript('')
  }, [])

  return (
    <div className="flex h-full flex-col items-center">
      {/* Transcript area */}
      <ScrollArea ref={scrollRef} className="flex-1 w-full max-w-2xl px-4">
        <div className="py-8 space-y-4">
          {messages.length === 0 && !transcript && (
            <div className="text-center py-16">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-muted mb-6">
                <Mic className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold mb-2">Voice Conversation</h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Click the microphone to start speaking. Your voice will be transcribed
                and the AI will respond with speech.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                'flex gap-3 p-3 rounded-lg',
                msg.role === 'user'
                  ? 'bg-primary/10 ml-12'
                  : 'bg-muted mr-12',
              )}
            >
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {msg.role === 'user' ? 'You' : 'AI'}
                </p>
                <p className="text-sm">{msg.content}</p>
              </div>
            </div>
          ))}

          {/* Live transcript */}
          {transcript && (
            <div className="flex gap-3 p-3 rounded-lg bg-primary/5 ml-12 border border-primary/20">
              <div className="flex-1">
                <p className="text-xs font-medium text-primary mb-1">Listening...</p>
                <p className="text-sm italic text-muted-foreground">{transcript}</p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Voice circle indicator */}
      <div className="py-8">
        <div
          className={cn(
            'relative flex h-32 w-32 items-center justify-center rounded-full transition-all duration-300',
            isListening
              ? 'bg-primary/20 shadow-[0_0_40px_rgba(var(--primary),0.3)]'
              : isSpeaking
                ? 'bg-blue-500/20 shadow-[0_0_40px_rgba(59,130,246,0.3)]'
                : 'bg-muted',
          )}
        >
          {/* Pulse animation when active */}
          {(isListening || isSpeaking) && (
            <div
              className={cn(
                'absolute inset-0 rounded-full animate-ping opacity-20',
                isListening ? 'bg-primary' : 'bg-blue-500',
              )}
            />
          )}
          {isListening ? (
            <Mic className="h-12 w-12 text-primary" />
          ) : isSpeaking ? (
            <Volume2 className="h-12 w-12 text-blue-500" />
          ) : (
            <MicOff className="h-12 w-12 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 pb-8">
        <Button
          variant={isListening ? 'destructive' : 'default'}
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={toggleListening}
        >
          {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>

        <Button
          variant={autoListen ? 'secondary' : 'outline'}
          size="sm"
          onClick={toggleAutoListen}
          className="gap-1.5"
        >
          {autoListen ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          Auto-listen
        </Button>

        <Button variant="outline" size="sm" onClick={stopAll} className="gap-1.5">
          <Square className="h-4 w-4" />
          Stop
        </Button>
      </div>
    </div>
  )
}
