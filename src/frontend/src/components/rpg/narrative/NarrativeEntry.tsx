import { cn } from '@/lib/utils'
import type { RpgNarration } from '@/types/rpg'

interface NarrativeEntryProps {
  entry: RpgNarration
  index: number
}

export function NarrativeEntry({ entry, index }: NarrativeEntryProps) {
  const isFirstParagraph = index === 0

  if (entry.type === 'player') {
    return (
      <div className="rpg-fade-in flex items-start gap-2 my-3">
        <div
          className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: 'rgba(74, 125, 255, 0.2)', color: 'var(--rpg-arcane)' }}
        >
          P
        </div>
        <p
          className="text-sm italic"
          style={{ color: 'var(--rpg-arcane)', fontFamily: "'Cormorant Garamond', serif", fontSize: '1rem' }}
        >
          &ldquo;{entry.content}&rdquo;
        </p>
      </div>
    )
  }

  if (entry.type === 'system') {
    return (
      <div className="rpg-fade-in text-center my-4">
        <div className="rpg-divider mb-3" />
        <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--rpg-gold-dim)' }}>
          {entry.content}
        </p>
        <div className="rpg-divider mt-3" />
      </div>
    )
  }

  if (entry.type === 'event') {
    return (
      <div
        className="rpg-fade-in rounded-lg p-3 my-2"
        style={{
          background: 'rgba(212, 165, 116, 0.08)',
          borderLeft: '3px solid var(--rpg-gold-dim)',
        }}
      >
        <p className="text-xs font-medium" style={{ color: 'var(--rpg-gold)', fontFamily: "'Cinzel', serif" }}>
          ⚡ Event
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--rpg-text)', fontFamily: "'Cormorant Garamond', serif", fontSize: '0.95rem' }}>
          {entry.content}
        </p>
      </div>
    )
  }

  if (entry.type === 'combat') {
    return (
      <div
        className="rpg-fade-in rounded-lg p-3 my-2"
        style={{
          background: 'rgba(199, 62, 62, 0.08)',
          borderLeft: '3px solid var(--rpg-ember)',
        }}
      >
        <p className="text-sm" style={{ color: 'var(--rpg-ember-bright)', fontFamily: "'Cormorant Garamond', serif" }}>
          ⚔️ {entry.content}
        </p>
      </div>
    )
  }

  if (entry.type === 'dialogue' && entry.speaker) {
    return (
      <div className="rpg-fade-in flex items-start gap-2 my-2">
        <div
          className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: 'rgba(167, 139, 250, 0.2)', color: 'var(--rpg-mana)' }}
        >
          {entry.speaker[0]?.toUpperCase()}
        </div>
        <div>
          <span className="text-xs font-semibold" style={{ color: 'var(--rpg-mana)', fontFamily: "'Cinzel', serif" }}>
            {entry.speaker}
          </span>
          <p className="text-sm mt-0.5" style={{ color: 'var(--rpg-text)', fontFamily: "'Cormorant Garamond', serif", fontSize: '1rem' }}>
            &ldquo;{entry.content}&rdquo;
          </p>
        </div>
      </div>
    )
  }

  // Default narration
  return (
    <div className={cn('rpg-fade-in', isFirstParagraph && 'rpg-drop-cap')}>
      <p
        className="text-sm leading-relaxed"
        style={{
          color: 'var(--rpg-text)',
          fontFamily: "'Cormorant Garamond', serif",
          fontSize: '1.05rem',
          lineHeight: '1.7',
        }}
      >
        {entry.content}
      </p>
    </div>
  )
}
