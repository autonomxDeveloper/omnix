import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { rpgSessionApi } from '@/api/endpoints/rpg-session'
import { rpgAdventureApi } from '@/api/endpoints/rpg-adventure'

/**
 * TanStack Query hooks for RPG session server state.
 * These are the single source of truth for session data fetched from the server.
 */

export function useRpgSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['rpg-session', sessionId],
    queryFn: () => rpgSessionApi.get(sessionId!),
    enabled: !!sessionId,
    staleTime: 10_000,
  })
}

export function useRpgSessions() {
  return useQuery({
    queryKey: ['rpg-sessions'],
    queryFn: () => rpgSessionApi.list(),
    staleTime: 30_000,
  })
}

export function useRpgWorldEvents(sessionId: string | null) {
  return useQuery({
    queryKey: ['rpg-world-events', sessionId],
    queryFn: () => rpgSessionApi.worldEvents(sessionId!),
    enabled: !!sessionId,
    staleTime: 15_000,
  })
}

export function useStartAdventure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (setupPayload?: unknown) => rpgAdventureApi.start(setupPayload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rpg-sessions'] })
    },
  })
}

export function useDeleteRpgSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => rpgSessionApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rpg-sessions'] })
    },
  })
}
