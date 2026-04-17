import { useParams } from 'react-router-dom'
import { useRpgStore } from '@/stores/rpg-store'
import { useRpgSession } from '@/hooks/use-rpg-session'
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
import { ChatInput } from '@/components/chat/ChatInput'
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
  
  console.log('[RPG] RpgView rendered: sessionId =', sessionId, 'adventureBuilderOpen =', adventureBuilderOpen);

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
      <ChatInputBar />
    </div>
  )
}
