import { api } from '../client'
import type { ChatSession } from '@/types/chat'

interface SessionsResponse {
  success: boolean
  sessions: ChatSession[]
}

interface SessionResponse {
  success: boolean
  session: ChatSession
}

export const chatApi = {
  async getSessions(): Promise<ChatSession[]> {
    const res = await api.get<SessionsResponse>('/api/sessions')
    return res.sessions || []
  },

  async getSession(id: string): Promise<ChatSession> {
    const res = await api.get<SessionResponse>(`/api/sessions/${id}`)
    return res.session
  },

  async createSession(): Promise<ChatSession> {
    const res = await api.post<SessionResponse>('/api/sessions')
    return res.session || res
  },

  async updateSession(id: string, data: Partial<ChatSession>): Promise<ChatSession> {
    const res = await api.put<SessionResponse>(`/api/sessions/${id}`, data)
    return res.session
  },

  async deleteSession(id: string): Promise<void> {
    await api.delete(`/api/sessions/${id}`)
  },

  async generateTitle(messages: { role: string; content: string }[]): Promise<string> {
    const res = await api.post<{ title: string }>('/api/sessions/generate-title', { messages })
    return res.title
  },

  streamChat(
    body: {
      message: string
      session_id?: string
      system_prompt?: string
      model?: string
      temperature?: number
      max_tokens?: number
    },
    signal?: AbortSignal,
  ) {
    return api.postStream('/api/chat/stream', body, { signal })
  },
}
