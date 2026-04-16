import { api } from '../client'

export const rpgAdventureApi = {
  async templates() {
    return api.get<{ templates: unknown[] }>('/api/rpg/adventure/templates')
  },

  async start(setupPayload?: unknown) {
    return api.post('/api/rpg/adventure/start', setupPayload || {})
  },

  async validate(setup: unknown) {
    return api.post('/api/rpg/adventure/validate', setup)
  },

  async preview(setup: unknown) {
    return api.post('/api/rpg/adventure/preview', setup)
  },

  async regenerate(section: string, setup: unknown) {
    return api.post('/api/rpg/adventure/regenerate', { section, setup })
  },

  async generateWorld(setup: unknown) {
    return api.post('/api/rpg/adventure/generate_world', setup)
  },

  async applyPackage(pkg: unknown) {
    return api.post('/api/rpg/adventure/apply_generated_package', pkg)
  },

  async inspectWorld(setup: unknown) {
    return api.post('/api/rpg/adventure/inspect-world', setup)
  },
}
