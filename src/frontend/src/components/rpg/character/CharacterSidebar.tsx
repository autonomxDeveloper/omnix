import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { rarityColors } from '../theme/rpg-theme'
import { Shield, Sword, Heart, Zap, Coins } from 'lucide-react'

export function CharacterSidebar() {
  const { player } = useRpgPlayerStore()

  return (
    <div className="rpg-glass rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--rpg-border)' }}
      >
        <span
          className="text-[10px] uppercase tracking-widest font-semibold"
          style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}
        >
          Character
        </span>
      </div>
      <div className="p-3 space-y-3">
        {/* XP Bar */}
        <div>
          <div className="flex justify-between text-[10px] mb-1">
            <span style={{ color: 'var(--rpg-gold)' }}>Level {player.level}</span>
            <span style={{ color: 'var(--rpg-text-dim)' }}>
              {player.xp}/{player.xp_to_next} XP
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${player.xp_to_next > 0 ? (player.xp / player.xp_to_next) * 100 : 0}%`,
                background: 'linear-gradient(90deg, var(--rpg-gold-dim), var(--rpg-gold))',
              }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(player.stats).slice(0, 6).map(([key, val]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase" style={{ color: 'var(--rpg-text-dim)' }}>
                {key.slice(0, 3)}
              </span>
              <span className="text-xs font-bold font-mono" style={{ color: 'var(--rpg-text)' }}>
                {val}
              </span>
            </div>
          ))}
        </div>

        {/* Gold */}
        <div className="flex items-center gap-1.5">
          <Coins className="h-3.5 w-3.5" style={{ color: 'var(--rpg-gold)' }} />
          <span className="text-xs font-mono" style={{ color: 'var(--rpg-gold-bright)' }}>
            {player.gold} gold
          </span>
        </div>

        {/* Quick inventory */}
        {player.inventory.length > 0 && (
          <div>
            <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--rpg-text-dim)' }}>
              Inventory ({player.inventory.length})
            </p>
            <div className="grid grid-cols-4 gap-1">
              {player.inventory.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="group relative flex h-10 w-10 items-center justify-center rounded text-xs cursor-pointer"
                  style={{
                    background: 'rgba(37, 37, 80, 0.6)',
                    border: `1px solid ${rarityColors[item.rarity] || rarityColors.common}40`,
                  }}
                  title={item.name}
                >
                  <span className="text-base">
                    {item.type === 'weapon' ? '⚔️' :
                     item.type === 'armor' ? '🛡️' :
                     item.type === 'consumable' ? '🧪' :
                     item.type === 'quest' ? '📜' : '💎'}
                  </span>
                  {item.quantity > 1 && (
                    <span
                      className="absolute bottom-0 right-0 text-[8px] font-mono px-0.5 rounded-tl"
                      style={{ background: 'rgba(0,0,0,0.7)', color: 'var(--rpg-text-dim)' }}
                    >
                      {item.quantity}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status effects */}
        {player.status_effects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {player.status_effects.map((effect, i) => (
              <span
                key={i}
                className="rounded px-1.5 py-0.5 text-[9px]"
                style={{
                  background: 'rgba(167, 139, 250, 0.15)',
                  color: 'var(--rpg-mana)',
                  border: '1px solid rgba(167, 139, 250, 0.3)',
                }}
              >
                {effect}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
