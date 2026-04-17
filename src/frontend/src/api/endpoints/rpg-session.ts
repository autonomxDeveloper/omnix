import { api } from '../client'
import type { RpgTurnResult } from '@/types/rpg'

export const rpgSessionApi = {
  async list() {
    return api.post<{ sessions: unknown[] }>('/api/rpg/session/list', {})
  },

  async get(sessionId: string) {
    return api.post('/api/rpg/session/get', { session_id: sessionId })
  },

  async turn(sessionId: string, action: string): Promise<RpgTurnResult> {
    return api.post('/api/rpg/session/turn', { session_id: sessionId, action })
  },

  async menuAction(action: string, sessionId?: string) {
    return api.post('/api/rpg/session/menu_action', { action, session_id: sessionId })
  },

  async settings(sessionId: string) {
    return api.post('/api/rpg/session/settings', { session_id: sessionId })
  },

  async worldEvents(sessionId: string) {
    return api.post('/api/rpg/session/world_events', { session_id: sessionId })
  },

  async poll(sessionId: string) {
    return api.post('/api/rpg/session/poll', { session_id: sessionId })
  },

  async idleTick(sessionId: string) {
    return api.post('/api/rpg/session/idle_tick', { session_id: sessionId })
  },

  async deleteSession(sessionId: string) {
    return api.post('/api/rpg/session/delete', { session_id: sessionId })
  },
}
