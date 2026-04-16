/* Types for chat domain */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  attachments?: Attachment[]
}

export interface Attachment {
  type: 'image' | 'file'
  name: string
  url?: string
  data?: string
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  created_at: string
  updated_at: string
  system_prompt?: string
  model?: string
}

export interface StreamChunk {
  content?: string
  done?: boolean
  error?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}
