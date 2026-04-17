import { useQuery } from '@tanstack/react-query'
import { servicesApi } from '@/api/endpoints/services'

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      try {
        const data = await servicesApi.providersStatus()
        return {
          llm: { connected: data?.llm?.available ?? false },
          tts: { connected: data?.tts?.available ?? false },
          stt: { connected: data?.stt?.available ?? true }
        }
      } catch {
        return {
          llm: { connected: false },
          tts: { connected: false },
          stt: { connected: false }
        }
      }
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
}

export function useSpeakers() {
  return useQuery({
    queryKey: ['speakers'],
    queryFn: servicesApi.speakers,
    staleTime: 60_000,
  })
}
