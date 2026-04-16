import { useRpgStore } from '@/stores/rpg-store'
import { rpgSessionApi } from '@/api/endpoints/rpg-session'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { choiceTypeColors } from '../theme/rpg-theme'
import { Swords, MessageCircle, Compass, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RpgChoice } from '@/types/rpg'

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  combat: Swords,
  dialogue: MessageCircle,
  explore: Compass,
  special: Sparkles,
}

export function ChoicePanel() {
  const { choices, sessionId, isLoading, setLoading, addNarration, setChoices, setNpcs, addDiceRoll, setTurn, currentTurn } = useRpgStore()
  const rpgPlayerStore = useRpgPlayerStore()

  if (choices.length === 0) return null

  const handleChoice = async (choice: RpgChoice) => {
    if (!sessionId || isLoading || choice.disabled) return

    setLoading(true)
    addNarration({ type: 'player', content: choice.text, turn: currentTurn })

    try {
      const result = await rpgSessionApi.turn(sessionId, choice.text)

      if (result.narration) {
        addNarration({ type: 'narration', content: result.narration, turn: currentTurn + 1 })
      }
      if (result.choices) setChoices(result.choices)
      if (result.npcs) setNpcs(result.npcs)
      if (result.rolls) result.rolls.forEach((r) => addDiceRoll(r))
      if (result.player) rpgPlayerStore.setPlayer(result.player)
      setTurn(currentTurn + 1)
    } catch (err) {
      addNarration({ type: 'system', content: `Error: ${(err as Error).message}`, turn: currentTurn })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="border-t p-4"
      style={{ borderColor: 'var(--rpg-border)', background: 'rgba(10, 10, 26, 0.9)' }}
    >
      <div className="mx-auto max-w-2xl">
        <p
          className="text-[10px] uppercase tracking-widest mb-3"
          style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}
        >
          Choose your action
        </p>
        <div className="grid gap-2">
          {choices.map((choice) => {
            const type = choice.type || 'explore'
            const colors = choiceTypeColors[type] || choiceTypeColors.explore
            const Icon = typeIcons[type] || Compass

            return (
              <button
                key={choice.id}
                onClick={() => handleChoice(choice)}
                disabled={choice.disabled || isLoading}
                className={cn(
                  'rpg-corner-ornament group flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-all duration-200 hover:scale-[1.01]',
                  choice.disabled && 'opacity-40 cursor-not-allowed',
                  isLoading && 'pointer-events-none opacity-60',
                )}
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: colors.text }} />
                <span
                  className="text-sm font-medium"
                  style={{
                    color: 'var(--rpg-text)',
                    fontFamily: "'Cormorant Garamond', serif",
                    fontSize: '0.95rem',
                  }}
                >
                  {choice.text}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
