import { api } from '../client'

export const audiobookApi = {
  async upload(formData: FormData) {
    return api.postFormData<{ pages: string[] }>('/api/audiobook/upload', formData)
  },

  async aiStructure(text: string) {
    return api.post<{ structure: unknown }>('/api/audiobook/ai-structure', { text })
  },

  async detectSpeakers(text: string) {
    return api.post<{ speakers: string[] }>('/api/audiobook/speakers/detect', { text })
  },

  async generate(config: unknown) {
    return api.post('/api/audiobook/generate', config)
  },

  async library() {
    return api.get<{ books: unknown[] }>('/api/audiobook/library')
  },
}

export const podcastApi = {
  async voiceProfiles() {
    return api.get<{ profiles: unknown[] }>('/api/podcast/voice-profiles')
  },

  async generateOutline(params: { topic: string; format: string }) {
    return api.post('/api/podcast/generate-outline', params)
  },

  async generate(config: unknown) {
    return api.post('/api/podcast/generate', config)
  },

  async listEpisodes() {
    return api.get<{ episodes: unknown[] }>('/api/podcast/episodes')
  },

  async deleteEpisode(id: string) {
    return api.delete(`/api/podcast/episodes/${id}`)
  },
}

export const storyApi = {
  async generate(config: { prompt: string; genre: string; voices?: Record<string, string> }) {
    return api.post('/api/story/generate', config)
  },

  async parse(text: string) {
    return api.post('/api/story/parse', { text })
  },
}
