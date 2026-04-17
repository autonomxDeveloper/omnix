import { create } from 'zustand'
import type { RpgDiceRoll } from '@/types/rpg'

/**
 * RPG store: owns ONLY ephemeral UI interaction state.
 * Server-fetched data (session, narration, NPCs, world) lives in TanStack Query
 * via useRpgSession / useRpgTurn hooks.
 * This store tracks streaming narration, pending dice rolls, and UI panel toggles.
 */
interface RpgState {
  /** Active streaming narration text from SSE */
  streamingNarration: string
  /** Dice rolls pending display/animation */
  pendingRolls: RpgDiceRoll[]
  /** Whether a turn request is in-flight */
  isTurnLoading: boolean
  /** UI panel toggles */
  dialogueActive: boolean
  dialogueNpcId: string | null
  inspectorOpen: boolean
  characterSheetOpen: boolean
  adventureBuilderOpen: boolean

  // actions
  setStreamingNarration: (text: string) => void
  appendStreamingNarration: (chunk: string) => void
  addDiceRoll: (roll: RpgDiceRoll) => void
  clearPendingRolls: () => void
  setTurnLoading: (loading: boolean) => void
  setDialogue: (active: boolean, npcId?: string | null) => void
  setInspectorOpen: (open: boolean) => void
  setCharacterSheetOpen: (open: boolean) => void
  setAdventureBuilderOpen: (open: boolean) => void
  resetUi: () => void
}

export const useRpgStore = create<RpgState>((set) => ({
  streamingNarration: '',
  pendingRolls: [],
  isTurnLoading: false,
  dialogueActive: false,
  dialogueNpcId: null,
  inspectorOpen: false,
  characterSheetOpen: false,
  adventureBuilderOpen: false,

  setStreamingNarration: (text) => set({ streamingNarration: text }),
  appendStreamingNarration: (chunk) =>
    set((s) => ({ streamingNarration: s.streamingNarration + chunk })),
  addDiceRoll: (roll) => set((s) => ({ pendingRolls: [...s.pendingRolls, roll] })),
  clearPendingRolls: () => set({ pendingRolls: [] }),
  setTurnLoading: (loading) => set({ isTurnLoading: loading }),
  setDialogue: (active, npcId = null) =>
    set({ dialogueActive: active, dialogueNpcId: npcId }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  setCharacterSheetOpen: (open) => set({ characterSheetOpen: open }),
  setAdventureBuilderOpen: (open) => set({ adventureBuilderOpen: open }),
  resetUi: () =>
    set({
      streamingNarration: '',
      pendingRolls: [],
      isTurnLoading: false,
      dialogueActive: false,
      dialogueNpcId: null,
    }),
}))
