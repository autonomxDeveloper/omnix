import { useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRpgStore } from '@/stores/rpg-store'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { rpgSessionApi } from '@/api/endpoints/rpg-session'
import type { RpgTurnResult } from '@/types/rpg'

/**
 * Centralized RPG turn hook.
 * Owns the turn request lifecycle and result distribution.
 *
 * State ownership:
 *   - TanStack Query: session data, narration history (cached, refetched on turn end)
 *   - Zustand (rpg-store): isTurnLoading, pendingRolls, streamingNarration (ephemeral UI)
 *   - Zustand (rpg-player-store): player stats (ephemeral, synced from turn result)
 *   - This hook: mutation lifecycle, result parsing, cache invalidation
 */
export function useRpgTurn(sessionId: string | null) {
  const queryClient = useQueryClient()
  const rpgStore = useRpgStore()
  const rpgPlayerStore = useRpgPlayerStore()

  const turnMutation = useMutation({
    mutationFn: (action: string) => {
      if (!sessionId) throw new Error('No active RPG session')
      return rpgSessionApi.turn(sessionId, action)
    },
    onMutate: () => {
      rpgStore.setTurnLoading(true)
    },
    onSuccess: (result: RpgTurnResult) => {
      // Distribute turn result to appropriate owners:
      // - Dice rolls → Zustand (ephemeral animation state)
      if (result.rolls) {
        result.rolls.forEach((r) => rpgStore.addDiceRoll(r))
      }
      // - Player state → Zustand player store (ephemeral, updated each turn)
      if (result.player) {
        rpgPlayerStore.setPlayer(result.player)
      }
      // - Narration, choices, NPCs, world → invalidate query cache
      //   so TanStack Query refetches the full session state
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['rpg-session', sessionId] })
      }
    },
    onError: (err) => {
      console.error('RPG turn error:', err)
    },
    onSettled: () => {
      rpgStore.setTurnLoading(false)
    },
  })

  const executeTurn = useCallback(
    (action: string) => {
      if (rpgStore.isTurnLoading) return
      turnMutation.mutate(action)
    },
    [turnMutation, rpgStore.isTurnLoading],
  )

  return {
    executeTurn,
    isPending: turnMutation.isPending,
    lastResult: turnMutation.data as RpgTurnResult | undefined,
    error: turnMutation.error,
  }
}
