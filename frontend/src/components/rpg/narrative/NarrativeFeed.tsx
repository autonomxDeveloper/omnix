import { useRef, useEffect } from 'react'
import { useRpgStore } from '@/stores/rpg-store'
import { NarrativeEntry } from './NarrativeEntry'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { RpgNarration } from '@/types/rpg'

interface NarrativeFeedProps {
  narration?: RpgNarration[]
}

export function NarrativeFeed({ narration = [] }: NarrativeFeedProps) {
  const { streamingNarration } = useRpgStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [narration, streamingNarration])

  return (
    <ScrollArea className="flex-1">
      <div className="rpg-parchment min-h-full p-6 space-y-4">
        {narration.map((entry: RpgNarration, i: number) => (
          <NarrativeEntry key={i} entry={entry} index={i} />
        ))}

        {/* Streaming narration */}
        {streamingNarration && (
          <div className="rpg-fade-in">
            <p
              className="text-sm leading-relaxed"
              style={{
                color: 'var(--rpg-text)',
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: '1.05rem',
              }}
            >
              {streamingNarration}
              <span
                className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom animate-pulse"
                style={{ background: 'var(--rpg-gold)' }}
              />
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
