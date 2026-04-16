import { api } from '../client'

export const ttsApi = {
  async generate(text: string, speaker?: string): Promise<Blob> {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker }),
    })
    return res.blob()
  },

  async cancelStream(): Promise<void> {
    await api.post('/api/tts/stream/cancel')
  },
}

export const sttApi = {
  async transcribe(audio: Blob): Promise<{ text: string }> {
    const formData = new FormData()
    formData.append('audio', audio)
    return api.postFormData('/api/stt', formData)
  },
}
