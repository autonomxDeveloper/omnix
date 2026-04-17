/* Types for RPG domain */

export interface RpgSession {
  session_id: string
  player: RpgPlayer
  world: RpgWorld
  npcs: RpgNpc[]
  quests: RpgQuest[]
  turn_count: number
  created_at: string
}

export interface RpgPlayer {
  name: string
  level: number
  hp: number
  max_hp: number
  mana: number
  max_mana: number
  xp: number
  xp_to_next: number
  gold: number
  stats: Record<string, number>
  inventory: RpgItem[]
  equipment: Record<string, RpgItem | null>
  abilities: RpgAbility[]
  status_effects: string[]
}

export interface RpgItem {
  id: string
  name: string
  description: string
  type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'material' | 'accessory'
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
  stats?: Record<string, number>
  quantity: number
  equippable?: boolean
  equipped?: boolean
}

export interface RpgAbility {
  id: string
  name: string
  description: string
  type: string
  level: number
  max_level: number
  xp: number
  xp_to_next: number
  cost?: number
}

export interface RpgNpc {
  id: string
  name: string
  description: string
  relationship: number
  disposition: 'friendly' | 'neutral' | 'hostile' | 'fearful'
  gender?: string
  role?: string
  faction?: string
  location?: string
  portrait?: string
  available_actions?: string[]
}

export interface RpgQuest {
  id: string
  title: string
  description: string
  status: 'active' | 'completed' | 'failed'
  objectives: RpgObjective[]
  rewards?: string[]
}

export interface RpgObjective {
  text: string
  completed: boolean
}

export interface RpgWorld {
  name: string
  description: string
  current_location: string
  regions: RpgRegion[]
  factions: RpgFaction[]
  time_of_day?: string
  weather?: string
}

export interface RpgRegion {
  id: string
  name: string
  description: string
  x: number
  y: number
  controlled_by?: string
  discovered: boolean
}

export interface RpgFaction {
  id: string
  name: string
  color: string
  reputation: number
}

export interface RpgChoice {
  id: string
  text: string
  type?: 'combat' | 'dialogue' | 'explore' | 'special'
  disabled?: boolean
  tooltip?: string
}

export interface RpgDiceRoll {
  type: string
  target: number
  result: number
  modifier: number
  success: boolean
  critical?: boolean
  description: string
}

export interface RpgNarration {
  type: 'narration' | 'event' | 'system' | 'player' | 'dialogue' | 'combat'
  content: string
  speaker?: string
  turn?: number
  timestamp?: string
}

export interface RpgTurnResult {
  narration: string
  choices: RpgChoice[]
  npcs: RpgNpc[]
  rolls: RpgDiceRoll[]
  map?: Partial<RpgWorld>
  memory: string[]
  world_events: string[]
  player: Partial<RpgPlayer>
  streaming?: boolean
}

export interface RpgEncounter {
  id: string
  type: 'combat' | 'social' | 'puzzle'
  enemies: RpgNpc[]
  turn_order: string[]
  current_turn: string
  round: number
  active: boolean
}

export interface MemoryEntry {
  text: string
  turn: number
  type: 'player' | 'world'
}

export interface WorldEvent {
  text: string
  turn: number
  type: string
}
