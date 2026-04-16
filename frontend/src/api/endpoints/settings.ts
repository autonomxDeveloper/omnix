import { api } from '../client'
import type { Settings } from '@/types/settings'

export const settingsApi = {
  async get(): Promise<Settings> {
    return api.get<Settings>('/api/settings')
  },

  async update(settings: Partial<Settings>): Promise<Settings> {
    return api.post<Settings>('/api/settings', settings)
  },
}
