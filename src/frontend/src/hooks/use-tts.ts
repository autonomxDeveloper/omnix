import { useQuery, useMutation } from '@tanstack/react-query'
import { servicesApi } from '@/api/endpoints/services'
import { useSettingsStore } from '@/stores/settings-store'

export function useSpeakers() {
  return useQuery({
    queryKey: ['speakers'],
    queryFn: servicesApi.speakers,
    staleTime: 60_000,
  })
}

export function useVoiceClones() {
  return useQuery({
    queryKey: ['voice_clones'],
    queryFn: servicesApi.voiceClones,
    staleTime: 60_000,
  })
}

export function useSpeak() {
  const { settings } = useSettingsStore()
  
  return useMutation({
    mutationFn: (text: string) => servicesApi.speak(text, settings.selected_voice),
  })
}