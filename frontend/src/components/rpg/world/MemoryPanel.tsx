import { ScrollArea } from '@/components/ui/scroll-area'
import type { MemoryEntry, WorldEvent } from '@/types/rpg'

interface MemoryPanelProps {
  memory?: MemoryEntry[]
  worldEvents?: WorldEvent[]
}

export function MemoryPanel({ memory = [], worldEvents = [] }: MemoryPanelProps) {

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
          Memory &amp; Events
        </span>
      </div>
      <ScrollArea className="max-h-[250px]">
        <div className="p-2 space-y-2">
          {/* Player memories */}
          {memory.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--rpg-arcane)' }}>
                📝 Memories
              </p>
              <div className="space-y-1">
                {memory.slice(-8).reverse().map((m: MemoryEntry, i: number) => (
                  <p key={i} className="text-[11px] leading-snug" style={{ color: 'var(--rpg-text-dim)' }}>
                    {m.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* World events */}
          {worldEvents.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--rpg-gold-dim)' }}>
                🌍 World Events
              </p>
              <div className="space-y-1">
                {worldEvents.slice(-8).reverse().map((e: WorldEvent, i: number) => (
                  <p key={i} className="text-[11px] leading-snug" style={{ color: 'var(--rpg-text-dim)' }}>
                    {e.text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {memory.length === 0 && worldEvents.length === 0 && (
            <p className="text-[11px] text-center py-4" style={{ color: 'var(--rpg-text-dim)' }}>
              Memories and events will appear as you play...
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
