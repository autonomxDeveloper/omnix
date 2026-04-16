import { useRpgStore } from '@/stores/rpg-store'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { rarityColors } from '../theme/rpg-theme'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X } from 'lucide-react'

export function CharacterSheet() {
  const { setCharacterSheetOpen } = useRpgStore()
  const { player } = useRpgPlayerStore()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div
        className="rpg-corner-ornament relative w-full max-w-3xl max-h-[85vh] rounded-xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, var(--rpg-bg-panel), var(--rpg-bg-deep))',
          border: '1px solid var(--rpg-border-gold)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--rpg-border)' }}>
          <div>
            <h2 style={{ fontFamily: "'Cinzel', serif", color: 'var(--rpg-gold)', fontSize: '1.25rem' }}>
              {player.name}
            </h2>
            <p className="text-xs" style={{ color: 'var(--rpg-text-dim)' }}>
              Level {player.level} Adventurer
            </p>
          </div>
          <button
            onClick={() => setCharacterSheetOpen(false)}
            className="rounded-full p-1.5 transition-colors"
            style={{ color: 'var(--rpg-text-dim)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="stats" className="p-4">
          <TabsList className="grid w-full grid-cols-4" style={{ background: 'rgba(37, 37, 80, 0.4)' }}>
            <TabsTrigger value="stats" style={{ fontFamily: "'Cinzel', serif", fontSize: '0.75rem' }}>Stats</TabsTrigger>
            <TabsTrigger value="inventory" style={{ fontFamily: "'Cinzel', serif", fontSize: '0.75rem' }}>Inventory</TabsTrigger>
            <TabsTrigger value="abilities" style={{ fontFamily: "'Cinzel', serif", fontSize: '0.75rem' }}>Abilities</TabsTrigger>
            <TabsTrigger value="quests" style={{ fontFamily: "'Cinzel', serif", fontSize: '0.75rem' }}>Quests</TabsTrigger>
          </TabsList>

          {/* Stats tab */}
          <TabsContent value="stats">
            <ScrollArea className="h-[50vh]">
              <div className="space-y-4 p-2">
                {/* Vital bars */}
                <div className="grid grid-cols-2 gap-4">
                  <StatBar label="Health" current={player.hp} max={player.max_hp} color="var(--rpg-ember)" icon="❤️" />
                  <StatBar label="Mana" current={player.mana} max={player.max_mana} color="var(--rpg-mana)" icon="💎" />
                </div>

                {/* XP */}
                <StatBar label="Experience" current={player.xp} max={player.xp_to_next} color="var(--rpg-gold)" icon="⭐" />

                {/* Attributes */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}>
                    Attributes
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {Object.entries(player.stats).map(([key, val]) => (
                      <div key={key} className="rounded-lg p-3 text-center" style={{ background: 'rgba(37, 37, 80, 0.4)', border: '1px solid var(--rpg-border)' }}>
                        <p className="text-lg font-bold font-mono" style={{ color: 'var(--rpg-text)' }}>{val}</p>
                        <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--rpg-text-dim)' }}>{key}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Inventory tab */}
          <TabsContent value="inventory">
            <ScrollArea className="h-[50vh]">
              <div className="p-2">
                <div className="grid grid-cols-2 gap-2">
                  {player.inventory.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg p-3 transition-all hover:scale-[1.01]"
                      style={{
                        background: 'rgba(37, 37, 80, 0.4)',
                        border: `1px solid ${rarityColors[item.rarity] || rarityColors.common}40`,
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {item.type === 'weapon' ? '⚔️' : item.type === 'armor' ? '🛡️' : item.type === 'consumable' ? '🧪' : '💎'}
                        </span>
                        <div>
                          <p className="text-xs font-semibold" style={{ color: rarityColors[item.rarity] || rarityColors.common }}>
                            {item.name}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--rpg-text-dim)' }}>
                            {item.type} • x{item.quantity}
                          </p>
                        </div>
                      </div>
                      {item.description && (
                        <p className="text-[10px] mt-1.5" style={{ color: 'var(--rpg-text-dim)', fontFamily: "'Cormorant Garamond', serif" }}>
                          {item.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {player.inventory.length === 0 && (
                  <p className="text-center py-8 text-sm" style={{ color: 'var(--rpg-text-dim)' }}>
                    Your inventory is empty
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Abilities tab */}
          <TabsContent value="abilities">
            <ScrollArea className="h-[50vh]">
              <div className="p-2 space-y-2">
                {player.abilities.map((ability) => (
                  <div
                    key={ability.id}
                    className="rounded-lg p-3"
                    style={{ background: 'rgba(37, 37, 80, 0.4)', border: '1px solid var(--rpg-border)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: 'var(--rpg-text)', fontFamily: "'Cinzel', serif" }}>
                        {ability.name}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--rpg-arcane)' }}>
                        Lv.{ability.level}/{ability.max_level}
                      </span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--rpg-text-dim)' }}>
                      {ability.description}
                    </p>
                    <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${ability.max_level > 0 ? (ability.level / ability.max_level) * 100 : 0}%`,
                          background: 'linear-gradient(90deg, var(--rpg-arcane-dim), var(--rpg-arcane))',
                        }}
                      />
                    </div>
                  </div>
                ))}
                {player.abilities.length === 0 && (
                  <p className="text-center py-8 text-sm" style={{ color: 'var(--rpg-text-dim)' }}>
                    No abilities learned yet
                  </p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* Quests tab placeholder */}
          <TabsContent value="quests">
            <ScrollArea className="h-[50vh]">
              <div className="p-2">
                <p className="text-center py-8 text-sm" style={{ color: 'var(--rpg-text-dim)' }}>
                  Quest log will appear as you discover quests
                </p>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

function StatBar({ label, current, max, color, icon }: {
  label: string
  current: number
  max: number
  color: string
  icon: string
}) {
  const pct = max > 0 ? (current / max) * 100 : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--rpg-text-dim)' }}>
          {icon} {label}
        </span>
        <span className="text-xs font-mono" style={{ color }}>
          {current}/{max}
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}80, ${color})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
    </div>
  )
}
