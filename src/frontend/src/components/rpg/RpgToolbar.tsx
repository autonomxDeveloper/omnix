import { useRpgStore } from '@/stores/rpg-store'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Eye, Settings, Volume2, User, Map } from 'lucide-react'
import type { RpgWorld } from '@/types/rpg'

interface RpgToolbarProps {
  world: RpgWorld | null
  currentTurn: number
}

export function RpgToolbar({ world, currentTurn }: RpgToolbarProps) {
  const { inspectorOpen, setInspectorOpen, setCharacterSheetOpen } = useRpgStore()
  const { player } = useRpgPlayerStore()

  return (
    <div
      className="flex h-11 items-center gap-3 border-b px-4"
      style={{
        borderColor: 'var(--rpg-border)',
        background: 'linear-gradient(180deg, rgba(17, 17, 40, 0.95), rgba(10, 10, 26, 0.98))',
      }}
    >
      {/* Character info */}
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-semibold"
          style={{ fontFamily: "'Cinzel', serif", color: 'var(--rpg-gold)' }}
        >
          {player.name}
        </span>
        <Badge variant="outline" className="text-[10px] h-5" style={{ borderColor: 'var(--rpg-border)', color: 'var(--rpg-text-dim)' }}>
          Lv.{player.level}
        </Badge>
      </div>

      {/* HP / Mana bars */}
      <div className="flex items-center gap-3">
        <MiniBar
          label="HP"
          current={player.hp}
          max={player.max_hp}
          color="var(--rpg-ember)"
          brightColor="var(--rpg-ember-bright)"
        />
        <MiniBar
          label="MP"
          current={player.mana}
          max={player.max_mana}
          color="#7c3aed"
          brightColor="var(--rpg-mana)"
        />
      </div>

      {/* Location */}
      {world && (
        <div className="flex items-center gap-1.5" style={{ color: 'var(--rpg-text-dim)' }}>
          <Map className="h-3.5 w-3.5" />
          <span className="text-xs">{world.current_location}</span>
        </div>
      )}

      {/* Turn counter */}
      <Badge variant="outline" className="text-[10px] h-5" style={{ borderColor: 'var(--rpg-border)', color: 'var(--rpg-text-dim)' }}>
        Turn {currentTurn}
      </Badge>

      <div className="flex-1" />

      {/* Tool buttons */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        style={{ color: 'var(--rpg-text-dim)' }}
        onClick={() => setCharacterSheetOpen(true)}
      >
        <User className="h-3.5 w-3.5" />
        Character
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        style={{ color: 'var(--rpg-text-dim)' }}
      >
        <Volume2 className="h-3.5 w-3.5" />
        Voices
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        style={{ color: inspectorOpen ? 'var(--rpg-arcane)' : 'var(--rpg-text-dim)' }}
        onClick={() => setInspectorOpen(!inspectorOpen)}
      >
        <Eye className="h-3.5 w-3.5" />
        Inspector
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        style={{ color: 'var(--rpg-text-dim)' }}
      >
        <Settings className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

function MiniBar({
  label,
  current,
  max,
  color,
  brightColor,
}: {
  label: string
  current: number
  max: number
  color: string
  brightColor: string
}) {
  const pct = max > 0 ? (current / max) * 100 : 0

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold" style={{ color: brightColor }}>
        {label}
      </span>
      <div
        className="relative h-2 w-20 overflow-hidden rounded-full"
        style={{ background: 'rgba(255,255,255,0.08)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}, ${brightColor})`,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
      <span className="text-[10px] font-mono" style={{ color: 'var(--rpg-text-dim)' }}>
        {current}/{max}
      </span>
    </div>
  )
}
