import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRpgStore } from '@/stores/rpg-store'
import { useRpgSession } from '@/hooks/use-rpg-session'
import { rpgDialogueApi } from '@/api/endpoints/rpg-dialogue'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { X, Send } from 'lucide-react'
import type { RpgNpc } from '@/types/rpg'

interface DialogueMessage {
  speaker: string
  content: string
  isPlayer: boolean
}

export function DialogueView() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const { dialogueNpcId, setDialogue } = useRpgStore()
  const { data: sessionData } = useRpgSession(sessionId || null)
  const [messages, setMessages] = useState<DialogueMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const session = sessionData as Record<string, unknown> | undefined
  const npcs = (session?.npcs || []) as RpgNpc[]
  const npc = npcs.find((n: RpgNpc) => n.id === dialogueNpcId)

  const handleSend = async () => {
    if (!input.trim() || !sessionId || loading) return

    const text = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { speaker: 'You', content: text, isPlayer: true }])
    setLoading(true)

    try {
      const result = await rpgDialogueApi.message(sessionId, text) as Record<string, unknown>
      if (result.reply) {
        setMessages((prev) => [...prev, {
          speaker: npc?.name || 'NPC',
          content: result.reply as string,
          isPlayer: false,
        }])
      }
    } catch {
      setMessages((prev) => [...prev, {
        speaker: 'System',
        content: 'Failed to get response',
        isPlayer: false,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleEnd = async () => {
    if (sessionId) {
      await rpgDialogueApi.end(sessionId).catch(() => {})
    }
    setDialogue(false)
  }

  return (
    <div className="flex flex-1 flex-col" style={{ background: 'var(--rpg-bg-deep)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--rpg-border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{
              background: 'rgba(167, 139, 250, 0.2)',
              color: 'var(--rpg-mana)',
              fontFamily: "'Cinzel', serif",
            }}
          >
            {npc?.name[0] || '?'}
          </div>
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--rpg-text)', fontFamily: "'Cinzel', serif" }}>
              {npc?.name || 'Unknown'}
            </span>
            {npc?.role && (
              <p className="text-[10px]" style={{ color: 'var(--rpg-text-dim)' }}>{npc.role}</p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleEnd}>
          <X className="h-4 w-4" style={{ color: 'var(--rpg-text-dim)' }} />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3 max-w-xl mx-auto">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.isPlayer ? 'justify-end' : 'justify-start'}`}>
              <div
                className="rounded-xl px-3 py-2 max-w-[80%]"
                style={{
                  background: msg.isPlayer
                    ? 'rgba(74, 125, 255, 0.15)'
                    : 'rgba(167, 139, 250, 0.1)',
                  border: `1px solid ${msg.isPlayer ? 'rgba(74, 125, 255, 0.3)' : 'rgba(167, 139, 250, 0.2)'}`,
                }}
              >
                <p className="text-[10px] font-semibold mb-0.5" style={{
                  color: msg.isPlayer ? 'var(--rpg-arcane)' : 'var(--rpg-mana)',
                  fontFamily: "'Cinzel', serif",
                }}>
                  {msg.speaker}
                </p>
                <p className="text-sm" style={{ color: 'var(--rpg-text)', fontFamily: "'Cormorant Garamond', serif" }}>
                  {msg.content}
                </p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-1 py-2 px-3">
              <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--rpg-mana)', animationDelay: '0ms' }} />
              <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--rpg-mana)', animationDelay: '150ms' }} />
              <span className="h-2 w-2 rounded-full animate-bounce" style={{ background: 'var(--rpg-mana)', animationDelay: '300ms' }} />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3" style={{ borderColor: 'var(--rpg-border)' }}>
        <div className="flex gap-2 max-w-xl mx-auto">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Speak to the NPC..."
            className="min-h-[40px] max-h-[100px] flex-1 resize-none border-0 text-sm"
            style={{
              background: 'rgba(37, 37, 80, 0.4)',
              color: 'var(--rpg-text)',
              fontFamily: "'Cormorant Garamond', serif",
            }}
            rows={1}
          />
          <Button size="icon" className="h-10 w-10 shrink-0" onClick={handleSend} disabled={loading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
