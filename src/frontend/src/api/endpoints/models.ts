import { api } from '../client'
import type { Model } from '@/types/api'

export const modelsApi = {
  async list(): Promise<Model[]> {
    const res = await api.get<{ models?: Model[] }>('/api/models')
    return res.models || []
  },

  async listLLM(): Promise<Model[]> {
    const res = await api.get<{ models?: Model[] }>('/api/llm/models')
    return res.models || []
  },

  async listOpenRouter(): Promise<Model[]> {
    const res = await api.get<{ models?: Model[] }>('/api/openrouter/models')
    return res.models || []
  },
}
