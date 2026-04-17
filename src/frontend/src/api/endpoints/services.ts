import { api } from '../client'
import type { Speaker, HealthResponse } from '@/types/api'

export const servicesApi = {
  async health(): Promise<HealthResponse> {
    return api.get<HealthResponse>('/api/health')
  },

  async providersStatus(): Promise<Record<string, { connected: boolean; error?: string }>> {
    return api.get('/api/providers/status')
  },

  async servicesStatus(): Promise<Record<string, unknown>> {
    return api.get('/api/services/status')
  },

  async speakers(): Promise<Speaker[]> {
    const res = await api.get<{ speakers?: Speaker[] }>('/api/tts/speakers')
    return res.speakers || []
  },
}
