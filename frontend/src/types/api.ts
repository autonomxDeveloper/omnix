/* Types for API responses */

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
}

export interface HealthResponse {
  status: string
  llm?: { connected: boolean; error?: string }
  tts?: { connected: boolean; error?: string }
  stt?: { connected: boolean; error?: string }
}

export interface Speaker {
  id: string
  name: string
  language?: string
  gender?: string
}

export interface Model {
  id: string
  name: string
  owned_by?: string
  size?: number
}

export interface VoiceClone {
  id: string
  name: string
  status: string
  created_at: string
}
