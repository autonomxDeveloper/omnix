/* Types for settings */

export type Provider =
  | 'lmstudio'
  | 'openrouter'
  | 'cerebras'
  | 'openai_compatible'
  | 'llamacpp'

export interface Settings {
  provider: Provider
  api_url?: string
  api_key?: string
  model?: string
  temperature: number
  max_tokens: number
  context_length: number
  system_prompt: string
  tts_enabled: boolean
  tts_speaker?: string
  stt_enabled: boolean
  custom_headers?: Record<string, string>[]
}

export interface ProviderStatus {
  name: string
  connected: boolean
  error?: string
}

export interface ServiceStatus {
  llm: ProviderStatus
  tts: ProviderStatus
  stt: ProviderStatus
}

export const SYSTEM_PROMPT_PRESETS: Record<string, string> = {
  conversational: 'You are a helpful conversational AI assistant.',
  coder: 'You are an expert software engineer. Write clean, well-documented code.',
  writer: 'You are a creative writing assistant. Help with stories, articles, and prose.',
  tutor: 'You are a patient teacher. Explain concepts clearly with examples.',
  analyst: 'You are a data analyst. Provide insights based on data and logic.',
  translator: 'You are a translation assistant. Translate between languages accurately.',
  debater: 'You are a skilled debater. Present balanced arguments on topics.',
  concise: 'You are a concise assistant. Give brief, direct answers.',
  rpg_game_master: 'You are an RPG Game Master. Create immersive fantasy adventures with dice rolls, NPCs, quests, and combat encounters.',
}
