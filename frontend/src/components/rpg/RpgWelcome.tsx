import { useRpgStore } from '@/stores/rpg-store'
import { rpgAdventureApi } from '@/api/endpoints/rpg-adventure'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { Button } from '@/components/ui/button'
import { Swords, Scroll, Sparkles } from 'lucide-react'

export function RpgWelcome() {
  const rpgStore = useRpgStore()
  const rpgPlayerStore = useRpgPlayerStore()

  const handleQuickStart = async () => {
    rpgStore.setLoading(true)
    try {
      const result = await rpgAdventureApi.start()
      const data = result as Record<string, unknown>
      if (data.session_id) {
        rpgStore.setSessionId(data.session_id as string)
        if (data.narration) {
          rpgStore.addNarration({
            type: 'narration',
            content: data.narration as string,
            turn: 0,
          })
        }
        if (data.choices) {
          rpgStore.setChoices(data.choices as typeof rpgStore.choices)
        }
        if (data.player) {
          rpgPlayerStore.setPlayer(data.player as unknown as typeof rpgPlayerStore.player)
        }
      }
    } catch (err) {
      console.error('Failed to start adventure:', err)
    } finally {
      rpgStore.setLoading(false)
    }
  }

  const handleAdventureBuilder = () => {
    rpgStore.setAdventureBuilderOpen(true)
  }

  return (
    <div className="rpg-theme flex h-full items-center justify-center" style={{ background: 'var(--rpg-bg-deep)' }}>
      <div className="flex flex-col items-center gap-8 text-center max-w-lg px-6">
        {/* Title */}
        <div className="space-y-3">
          <h1
            className="text-4xl font-bold tracking-wider"
            style={{ fontFamily: "'Cinzel', serif", color: 'var(--rpg-gold)' }}
          >
            ⚔️ OMNIX RPG
          </h1>
          <div className="rpg-divider w-64 mx-auto" />
          <p style={{ color: 'var(--rpg-text-dim)', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.1rem' }}>
            Embark on an AI-powered fantasy adventure with dynamic storytelling, living NPCs, and epic quests.
          </p>
        </div>

        {/* Action cards */}
        <div className="grid gap-4 w-full">
          <button
            onClick={handleQuickStart}
            className="rpg-corner-ornament group flex items-center gap-4 rounded-lg p-5 transition-all duration-300 hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, rgba(74, 125, 255, 0.1), rgba(26, 26, 62, 0.8))',
              border: '1px solid rgba(74, 125, 255, 0.3)',
            }}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(74, 125, 255, 0.2)' }}>
              <Swords className="h-6 w-6" style={{ color: 'var(--rpg-arcane)' }} />
            </div>
            <div className="text-left">
              <div className="font-semibold" style={{ color: 'var(--rpg-text)', fontFamily: "'Cinzel', serif" }}>
                Quick Adventure
              </div>
              <div className="text-sm" style={{ color: 'var(--rpg-text-dim)' }}>
                Jump into a randomly generated world with a pre-built character
              </div>
            </div>
          </button>

          <button
            onClick={handleAdventureBuilder}
            className="rpg-corner-ornament group flex items-center gap-4 rounded-lg p-5 transition-all duration-300 hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, rgba(212, 165, 116, 0.1), rgba(26, 26, 62, 0.8))',
              border: '1px solid var(--rpg-border-gold)',
            }}
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ background: 'rgba(212, 165, 116, 0.2)' }}>
              <Scroll className="h-6 w-6" style={{ color: 'var(--rpg-gold)' }} />
            </div>
            <div className="text-left">
              <div className="font-semibold" style={{ color: 'var(--rpg-text)', fontFamily: "'Cinzel', serif" }}>
                Adventure Builder
              </div>
              <div className="text-sm" style={{ color: 'var(--rpg-text-dim)' }}>
                Craft your own world, character, and story from scratch
              </div>
            </div>
          </button>

          <Button
            variant="ghost"
            className="gap-2 text-sm"
            style={{ color: 'var(--rpg-text-dim)' }}
          >
            <Sparkles className="h-4 w-4" />
            Load Saved Adventure
          </Button>
        </div>
      </div>
    </div>
  )
}
