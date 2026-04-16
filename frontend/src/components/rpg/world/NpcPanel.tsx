import { NpcCard } from './NpcCard'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RpgNpc } from '@/types/rpg'

interface NpcPanelProps {
  npcs: RpgNpc[]
  sessionId: string
}

export function NpcPanel({ npcs }: NpcPanelProps) {

  if (npcs.length === 0) return null

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
          Nearby NPCs
        </span>
        <span className="text-[10px]" style={{ color: 'var(--rpg-text-dim)' }}>
          {npcs.length}
        </span>
      </div>
      <ScrollArea className="max-h-[300px]">
        <div className="p-2 space-y-1.5">
          {npcs.map((npc) => (
            <NpcCard key={npc.id} npc={npc} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
