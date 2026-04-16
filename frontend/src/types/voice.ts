/* Types for voice domain */

export interface VoiceState {
  isListening: boolean
  isSpeaking: boolean
  isProcessing: boolean
  autoListen: boolean
  transcript: string
  partialTranscript: string
}

export interface VoiceMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface VoiceStudioParams {
  text: string
  voice: string
  emotion: 'neutral' | 'happy' | 'sad' | 'angry' | 'dramatic'
  speed: number
  pitch: number
}

export interface AudiobookConfig {
  text: string
  speakers: Record<string, string>
  style: string
}

export interface PodcastConfig {
  topic: string
  format: 'interview' | 'debate' | 'educational' | 'storytelling' | 'conversation'
  length: 'short' | 'medium' | 'long' | 'extended'
  voices: Record<string, string>
}

export interface StoryConfig {
  prompt: string
  genre: string
  voices: Record<string, string>
}
