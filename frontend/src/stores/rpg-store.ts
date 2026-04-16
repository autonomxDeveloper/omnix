import { create } from 'zustand'
import type {
  RpgNarration,
  RpgChoice,
  RpgNpc,
  RpgDiceRoll,
  RpgWorld,
  MemoryEntry,
  WorldEvent,
  RpgEncounter,
} from '@/types/rpg'

interface RpgState {
  sessionId: string | null
  isLoading: boolean
  currentTurn: number
  narration: RpgNarration[]
  choices: RpgChoice[]
  npcs: RpgNpc[]
  pendingRolls: RpgDiceRoll[]
  world: RpgWorld | null
  memory: MemoryEntry[]
  worldEvents: WorldEvent[]
  encounter: RpgEncounter | null
  streamingNarration: string
  dialogueActive: boolean
  dialogueNpcId: string | null
  inspectorOpen: boolean
  characterSheetOpen: boolean
  adventureBuilderOpen: boolean

  // actions
  setSessionId: (id: string | null) => void
  setLoading: (loading: boolean) => void
  setTurn: (turn: number) => void
  addNarration: (entry: RpgNarration) => void
  setNarration: (entries: RpgNarration[]) => void
  setChoices: (choices: RpgChoice[]) => void
  setNpcs: (npcs: RpgNpc[]) => void
  addDiceRoll: (roll: RpgDiceRoll) => void
  clearPendingRolls: () => void
  setWorld: (world: RpgWorld | null) => void
  addMemory: (entry: MemoryEntry) => void
  setMemory: (entries: MemoryEntry[]) => void
  addWorldEvent: (event: WorldEvent) => void
  setWorldEvents: (events: WorldEvent[]) => void
  setEncounter: (encounter: RpgEncounter | null) => void
  setStreamingNarration: (text: string) => void
  appendStreamingNarration: (chunk: string) => void
  setDialogue: (active: boolean, npcId?: string | null) => void
  setInspectorOpen: (open: boolean) => void
  setCharacterSheetOpen: (open: boolean) => void
  setAdventureBuilderOpen: (open: boolean) => void
  resetGame: () => void
}

export const useRpgStore = create<RpgState>((set) => ({
  sessionId: null,
  isLoading: false,
  currentTurn: 0,
  narration: [],
  choices: [],
  npcs: [],
  pendingRolls: [],
  world: null,
  memory: [],
  worldEvents: [],
  encounter: null,
  streamingNarration: '',
  dialogueActive: false,
  dialogueNpcId: null,
  inspectorOpen: false,
  characterSheetOpen: false,
  adventureBuilderOpen: false,

  setSessionId: (id) => set({ sessionId: id }),
  setLoading: (loading) => set({ isLoading: loading }),
  setTurn: (turn) => set({ currentTurn: turn }),
  addNarration: (entry) => set((s) => ({ narration: [...s.narration, entry] })),
  setNarration: (entries) => set({ narration: entries }),
  setChoices: (choices) => set({ choices }),
  setNpcs: (npcs) => set({ npcs }),
  addDiceRoll: (roll) => set((s) => ({ pendingRolls: [...s.pendingRolls, roll] })),
  clearPendingRolls: () => set({ pendingRolls: [] }),
  setWorld: (world) => set({ world }),
  addMemory: (entry) =>
    set((s) => ({ memory: [...s.memory.slice(-23), entry] })),
  setMemory: (entries) => set({ memory: entries }),
  addWorldEvent: (event) =>
    set((s) => ({ worldEvents: [...s.worldEvents.slice(-23), event] })),
  setWorldEvents: (events) => set({ worldEvents: events }),
  setEncounter: (encounter) => set({ encounter }),
  setStreamingNarration: (text) => set({ streamingNarration: text }),
  appendStreamingNarration: (chunk) =>
    set((s) => ({ streamingNarration: s.streamingNarration + chunk })),
  setDialogue: (active, npcId = null) =>
    set({ dialogueActive: active, dialogueNpcId: npcId }),
  setInspectorOpen: (open) => set({ inspectorOpen: open }),
  setCharacterSheetOpen: (open) => set({ characterSheetOpen: open }),
  setAdventureBuilderOpen: (open) => set({ adventureBuilderOpen: open }),
  resetGame: () =>
    set({
      sessionId: null,
      currentTurn: 0,
      narration: [],
      choices: [],
      npcs: [],
      pendingRolls: [],
      world: null,
      memory: [],
      worldEvents: [],
      encounter: null,
      streamingNarration: '',
      dialogueActive: false,
      dialogueNpcId: null,
    }),
}))
