import { useState, useRef, useCallback } from 'react'

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null)

  const play = useCallback(async (audioBase64: string, messageId: string, sampleRate = 24000) => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.remove()
    }

    const binary = atob(audioBase64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    
    const blob = new Blob([bytes.buffer], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    
    const audio = new Audio(url)
    audioRef.current = audio
    
    setIsPlaying(true)
    setCurrentPlayingId(messageId)
    
    audio.onended = () => {
      setIsPlaying(false)
      setCurrentPlayingId(null)
      URL.revokeObjectURL(url)
    }
    
    audio.onerror = () => {
      setIsPlaying(false)
      setCurrentPlayingId(null)
      URL.revokeObjectURL(url)
    }
    
    await audio.play()
  }, [])

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlaying(false)
    setCurrentPlayingId(null)
  }, [])

  return {
    play,
    stop,
    isPlaying,
    currentPlayingId,
  }
}