import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useRpgStore } from '@/stores/rpg-store'
import { useRpgSession } from '@/hooks/use-rpg-session'
import { useRpgTurn } from '@/hooks/use-rpg-turn'
import { NarrativeFeed } from './narrative/NarrativeFeed'
import { ChoicePanel } from './narrative/ChoicePanel'
import { NpcPanel } from './world/NpcPanel'
import { Minimap } from './world/Minimap'
import { MemoryPanel } from './world/MemoryPanel'
import { CharacterSidebar } from './character/CharacterSidebar'
import { DiceOverlay } from './combat/DiceOverlay'
import { RpgToolbar } from './RpgToolbar'
import { RpgWelcome } from './RpgWelcome'
import { InspectorShell } from './inspector/InspectorShell'
import { DialogueView } from './dialogue/DialogueView'
import { CharacterSheet } from './character/CharacterSheet'
import { AdventureBuilder } from './builder/AdventureBuilder'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import './theme/rpg-animations.css'

export function RpgView() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const {
    pendingRolls,
    inspectorOpen,
    characterSheetOpen,
    adventureBuilderOpen,
    dialogueActive,
  } = useRpgStore()

  // Fetch session data from server (TanStack Query owns this)
  const { data: sessionData } = useRpgSession(sessionId || null)

  // Derive display data from server state
  const session = sessionData as Record<string, unknown> | undefined
  const choices = (session?.choices || []) as import('@/types/rpg').RpgChoice[]
  const npcs = (session?.npcs || []) as import('@/types/rpg').RpgNpc[]
  const world = session?.world as import('@/types/rpg').RpgWorld | undefined
  const narration = (session?.narration || []) as import('@/types/rpg').RpgNarration[]
  const memory = (session?.memory || []) as import('@/types/rpg').MemoryEntry[]
  const worldEvents = (session?.world_events || []) as import('@/types/rpg').WorldEvent[]
  const currentTurn = (session?.turn_count || 0) as number

  if (adventureBuilderOpen) {
    return <AdventureBuilder />
  }

  if (!sessionId) {
    return <RpgWelcome />
  }

  return (
    <div className="rpg-theme relative flex h-full flex-col overflow-hidden" style={{ background: 'var(--rpg-bg-deep)' }}>
      <RpgToolbar world={world || null} currentTurn={currentTurn} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Column - World Info */}
        <div className="flex w-64 flex-col gap-2 overflow-y-auto p-3 border-r" style={{ borderColor: 'var(--rpg-border)' }}>
          <Minimap world={world} />
          <NpcPanel npcs={npcs} sessionId={sessionId} />
        </div>

        {/* Center Column - Narrative */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {dialogueActive ? (
            <DialogueView />
          ) : (
            <>
              <NarrativeFeed narration={narration} />
              <ChoicePanel choices={choices} sessionId={sessionId} />
            </>
          )}
        </div>

        {/* Right Column - Character */}
        <div className="flex w-72 flex-col gap-2 overflow-y-auto p-3 border-l" style={{ borderColor: 'var(--rpg-border)' }}>
          <CharacterSidebar />
          <MemoryPanel memory={memory} worldEvents={worldEvents} />
        </div>
      </div>

      {/* Overlays */}
      {pendingRolls.length > 0 && <DiceOverlay />}
      {inspectorOpen && <InspectorShell />}
      {characterSheetOpen && <CharacterSheet />}
      
      {/* Chat Input Bar */}
      <RpgChatInputBar sessionId={sessionId} />
    </div>
  )
}

/** Free-form text input for RPG turns, wired to useRpgTurn */
function RpgChatInputBar({ sessionId }: { sessionId: string }) {
  const [input, setInput] = useState('')
  const { isTurnLoading } = useRpgStore()
  const { executeTurn, isPending } = useRpgTurn(sessionId)
  const isLoading = isTurnLoading || isPending

  const handleSend = () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    executeTurn(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      className="border-t p-3"
      style={{ borderColor: 'var(--rpg-border)', background: 'rgba(10, 10, 26, 0.95)' }}
    >
      <div className="mx-auto max-w-2xl flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your action..."
          className="min-h-[40px] max-h-[100px] flex-1 resize-none border-0 text-sm"
          style={{
            background: 'rgba(37, 37, 80, 0.4)',
            color: 'var(--rpg-text)',
            fontFamily: "'Cormorant Garamond', serif",
          }}
          rows={1}
          disabled={isLoading}
        />
        <Button
          size="icon"
          className="h-10 w-10 shrink-0"
          disabled={!input.trim() || isLoading}
          onClick={handleSend}
          style={{
            background: isLoading ? undefined : 'linear-gradient(135deg, var(--rpg-gold-dim), var(--rpg-gold))',
            color: 'var(--rpg-bg-deep)',
          }}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
