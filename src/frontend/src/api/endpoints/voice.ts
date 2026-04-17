import { api } from '../client'
import type { VoiceClone } from '@/types/api'

export const voiceApi = {
  async listClones(): Promise<VoiceClone[]> {
    const res = await api.get<{ voices?: VoiceClone[] }>('/api/voice_clones')
    return res.voices || []
  },

  async createClone(formData: FormData): Promise<VoiceClone> {
    return api.postFormData<VoiceClone>('/api/voice_clone', formData)
  },

  async deleteClone(id: string): Promise<void> {
    await api.delete(`/api/voice_clones/${id}`)
  },

  async studioGenerate(params: {
    text: string
    voice: string
    emotion?: string
    speed?: number
    pitch?: number
  }): Promise<Blob> {
    const res = await fetch('/api/voice_studio/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    return res.blob()
  },

  async studioVoices(): Promise<{ voices: string[] }> {
    return api.get('/api/voice_studio/voices')
  },
}
