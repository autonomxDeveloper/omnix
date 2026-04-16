import { useRpgStore } from '@/stores/rpg-store'
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
import './theme/rpg-animations.css'

export function RpgView() {
  const {
    sessionId,
    pendingRolls,
    inspectorOpen,
    characterSheetOpen,
    adventureBuilderOpen,
    dialogueActive,
  } = useRpgStore()

  if (!sessionId) {
    return <RpgWelcome />
  }

  if (adventureBuilderOpen) {
    return <AdventureBuilder />
  }

  return (
    <div className="rpg-theme relative flex h-full flex-col overflow-hidden" style={{ background: 'var(--rpg-bg-deep)' }}>
      <RpgToolbar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Column - World Info */}
        <div className="flex w-64 flex-col gap-2 overflow-y-auto p-3 border-r" style={{ borderColor: 'var(--rpg-border)' }}>
          <Minimap />
          <NpcPanel />
        </div>

        {/* Center Column - Narrative */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {dialogueActive ? (
            <DialogueView />
          ) : (
            <>
              <NarrativeFeed />
              <ChoicePanel />
            </>
          )}
        </div>

        {/* Right Column - Character */}
        <div className="flex w-72 flex-col gap-2 overflow-y-auto p-3 border-l" style={{ borderColor: 'var(--rpg-border)' }}>
          <CharacterSidebar />
          <MemoryPanel />
        </div>
      </div>

      {/* Overlays */}
      {pendingRolls.length > 0 && <DiceOverlay />}
      {inspectorOpen && <InspectorShell />}
      {characterSheetOpen && <CharacterSheet />}
    </div>
  )
}
