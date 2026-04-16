import { api } from '../client'
import type { RpgPlayer, RpgItem } from '@/types/rpg'

export const rpgPlayerApi = {
  async state(sessionId: string): Promise<{ player: RpgPlayer }> {
    return api.post('/api/rpg/player/state', { session_id: sessionId })
  },

  async journal(sessionId: string) {
    return api.post('/api/rpg/player/journal', { session_id: sessionId })
  },

  async codex(sessionId: string) {
    return api.post('/api/rpg/player/codex', { session_id: sessionId })
  },

  async objectives(sessionId: string) {
    return api.post('/api/rpg/player/objectives', { session_id: sessionId })
  },

  async inventory(sessionId: string): Promise<{ inventory: RpgItem[] }> {
    return api.post('/api/rpg/player/inventory', { session_id: sessionId })
  },

  async useItem(sessionId: string, itemId: string) {
    return api.post('/api/rpg/player/inventory/use', { session_id: sessionId, item_id: itemId })
  },

  async equipItem(sessionId: string, itemId: string) {
    return api.post('/api/rpg/player/inventory/equip', { session_id: sessionId, item_id: itemId })
  },

  async unequipItem(sessionId: string, itemId: string) {
    return api.post('/api/rpg/player/inventory/unequip', { session_id: sessionId, item_id: itemId })
  },

  async dropItem(sessionId: string, itemId: string) {
    return api.post('/api/rpg/player/inventory/drop', { session_id: sessionId, item_id: itemId })
  },

  async progression(sessionId: string) {
    return api.post('/api/rpg/player/progression', { session_id: sessionId })
  },

  async allocateStats(sessionId: string, stats: Record<string, number>) {
    return api.post('/api/rpg/player/stats/allocate', { session_id: sessionId, stats })
  },

  async party(sessionId: string) {
    return api.post('/api/rpg/player/party', { session_id: sessionId })
  },
}
