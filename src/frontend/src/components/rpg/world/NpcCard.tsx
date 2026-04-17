import { useRpgStore } from '@/stores/rpg-store'
import { dispositionColors } from '../theme/rpg-theme'
import { MessageCircle, ShoppingBag, Eye } from 'lucide-react'
import type { RpgNpc } from '@/types/rpg'

interface NpcCardProps {
  npc: RpgNpc
}

export function NpcCard({ npc }: NpcCardProps) {
  const { setDialogue } = useRpgStore()
  const dispositionColor = dispositionColors[npc.disposition] || dispositionColors.neutral

  // Relationship bar: -100 to 100, normalized to 0-100
  const relPct = Math.max(0, Math.min(100, ((npc.relationship + 100) / 200) * 100))

  const relColor =
    npc.relationship >= 50 ? '#4ade80' :
    npc.relationship >= 0 ? '#facc15' :
    npc.relationship >= -50 ? '#f97316' : '#ef4444'

  return (
    <div
      className="rpg-corner-ornament group rounded-lg p-2.5 transition-all duration-200 hover:scale-[1.01] cursor-pointer"
      style={{
        background: 'rgba(26, 26, 62, 0.6)',
        border: '1px solid var(--rpg-border)',
      }}
    >
      <div className="flex items-start gap-2.5">
        {/* Portrait */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
          style={{
            background: `${dispositionColor}15`,
            color: dispositionColor,
            border: `1px solid ${dispositionColor}40`,
            fontFamily: "'Cinzel', serif",
          }}
        >
          {npc.name[0]}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name and role */}
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs font-semibold truncate"
              style={{ color: 'var(--rpg-text)', fontFamily: "'Cinzel', serif" }}
            >
              {npc.name}
            </span>
            <span className="text-[9px]" style={{ color: dispositionColor }}>
              ● {npc.disposition}
            </span>
          </div>

          {npc.role && (
            <p className="text-[10px] truncate mt-0.5" style={{ color: 'var(--rpg-text-dim)' }}>
              {npc.role}
            </p>
          )}

          {/* Relationship bar */}
          <div className="mt-1.5">
            <div
              className="h-1 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${relPct}%`,
                  background: `linear-gradient(90deg, ${relColor}80, ${relColor})`,
                }}
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setDialogue(true, npc.id)}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px]"
              style={{
                background: 'rgba(74, 125, 255, 0.15)',
                color: 'var(--rpg-arcane)',
                border: '1px solid rgba(74, 125, 255, 0.3)',
              }}
            >
              <MessageCircle className="h-2.5 w-2.5" /> Talk
            </button>
            <button
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px]"
              style={{
                background: 'rgba(212, 165, 116, 0.15)',
                color: 'var(--rpg-gold)',
                border: '1px solid var(--rpg-border-gold)',
              }}
            >
              <ShoppingBag className="h-2.5 w-2.5" /> Trade
            </button>
            <button
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px]"
              style={{
                background: 'rgba(148, 163, 184, 0.1)',
                color: 'var(--rpg-text-dim)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
              }}
            >
              <Eye className="h-2.5 w-2.5" /> Inspect
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
