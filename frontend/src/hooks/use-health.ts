import { useQuery } from '@tanstack/react-query'
import { servicesApi } from '@/api/endpoints/services'

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: servicesApi.health,
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
