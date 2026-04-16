import { api } from '../client'

export const rpgDialogueApi = {
  async start(sessionId: string, npcId: string, sceneId?: string) {
    return api.post('/api/rpg/dialogue/start', {
      session_id: sessionId,
      npc_id: npcId,
      scene_id: sceneId,
    })
  },

  async message(sessionId: string, message: string) {
    return api.post('/api/rpg/dialogue/message', {
      session_id: sessionId,
      message,
    })
  },

  async end(sessionId: string) {
    return api.post('/api/rpg/dialogue/end', { session_id: sessionId })
  },
}

export const rpgEncounterApi = {
  async start(sessionId: string) {
    return api.post('/api/rpg/encounter/start', { session_id: sessionId })
  },

  async action(sessionId: string, actionType: string, target?: string) {
    return api.post('/api/rpg/encounter/action', {
      session_id: sessionId,
      action: actionType,
      target,
    })
  },

  async npcTurn(sessionId: string) {
    return api.post('/api/rpg/encounter/npc_turn', { session_id: sessionId })
  },

  async end(sessionId: string) {
    return api.post('/api/rpg/encounter/end', { session_id: sessionId })
  },
}
