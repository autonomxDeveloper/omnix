import { api } from '../client'

export const rpgPresentationApi = {
  async scene(sessionId: string) {
    return api.post('/api/rpg/presentation/scene', { session_id: sessionId })
  },

  async dialogue(sessionId: string) {
    return api.post('/api/rpg/presentation/dialogue', { session_id: sessionId })
  },

  async characterUi(sessionId: string) {
    return api.post('/api/rpg/character_ui', { session_id: sessionId })
  },

  async characterInspector(sessionId: string) {
    return api.post('/api/rpg/character_inspector', { session_id: sessionId })
  },

  async worldInspector(sessionId: string) {
    return api.post('/api/rpg/world_inspector', { session_id: sessionId })
  },

  async sessionBootstrap(sessionId: string) {
    return api.post('/api/rpg/session-bootstrap', { session_id: sessionId })
  },

  async introScene(sessionId: string) {
    return api.post('/api/rpg/intro-scene', { session_id: sessionId })
  },

  async narrativeRecap(sessionId: string) {
    return api.post('/api/rpg/narrative-recap', { session_id: sessionId })
  },

  async gmTrace(sessionId: string) {
    return api.post('/api/rpg/gm_trace', { session_id: sessionId })
  },
}

export const rpgInspectorApi = {
  async timeline(sessionId: string) {
    return api.post('/api/rpg/inspect/timeline', { session_id: sessionId })
  },

  async timelineTick(sessionId: string, tick: number) {
    return api.post('/api/rpg/inspect/timeline_tick', { session_id: sessionId, tick })
  },

  async tickDiff(sessionId: string, tickA: number, tickB: number) {
    return api.post('/api/rpg/inspect/tick_diff', { session_id: sessionId, tick_a: tickA, tick_b: tickB })
  },

  async npcReasoning(sessionId: string, npcId?: string) {
    return api.post('/api/rpg/inspect/npc_reasoning', { session_id: sessionId, npc_id: npcId })
  },

  async worldEvents(sessionId: string) {
    return api.post('/api/rpg/inspect/world_events', { session_id: sessionId })
  },
}
