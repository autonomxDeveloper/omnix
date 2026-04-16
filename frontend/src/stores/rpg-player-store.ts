import { create } from 'zustand'
import type { RpgPlayer } from '@/types/rpg'

const defaultPlayer: RpgPlayer = {
  name: 'Adventurer',
  level: 1,
  hp: 100,
  max_hp: 100,
  mana: 50,
  max_mana: 50,
  xp: 0,
  xp_to_next: 100,
  gold: 0,
  stats: {},
  inventory: [],
  equipment: {},
  abilities: [],
  status_effects: [],
}

interface RpgPlayerState {
  player: RpgPlayer
  setPlayer: (player: Partial<RpgPlayer>) => void
  resetPlayer: () => void
}

export const useRpgPlayerStore = create<RpgPlayerState>((set) => ({
  player: defaultPlayer,
  setPlayer: (partial) =>
    set((s) => ({ player: { ...s.player, ...partial } })),
  resetPlayer: () => set({ player: defaultPlayer }),
}))
