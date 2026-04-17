import { useEffect, useState } from 'react'
import { useRpgStore } from '@/stores/rpg-store'
import { cn } from '@/lib/utils'

export function DiceOverlay() {
  const { pendingRolls, clearPendingRolls } = useRpgStore()
  const [currentRoll, setCurrentRoll] = useState(pendingRolls[0])
  const [phase, setPhase] = useState<'rolling' | 'result'>('rolling')
  const [displayNum, setDisplayNum] = useState(0)

  useEffect(() => {
    if (pendingRolls.length === 0) return
    setCurrentRoll(pendingRolls[0])
    setPhase('rolling')

    // Spinning number animation
    const interval = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 20) + 1)
    }, 60)

    // Show result after animation
    const timer = setTimeout(() => {
      clearInterval(interval)
      setPhase('result')
      setDisplayNum(pendingRolls[0].result)
    }, 800)

    // Auto-close
    const close = setTimeout(() => {
      clearPendingRolls()
    }, 3500)

    return () => {
      clearInterval(interval)
      clearTimeout(timer)
      clearTimeout(close)
    }
  }, [pendingRolls, clearPendingRolls])

  if (!currentRoll) return null

  const isCritical = currentRoll.critical
  const isSuccess = currentRoll.success

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div
        className={cn(
          'flex flex-col items-center gap-4 rounded-2xl p-8 pointer-events-auto',
          isCritical && 'rpg-critical-glow',
        )}
        style={{
          background: 'rgba(10, 10, 26, 0.95)',
          border: `2px solid ${isCritical ? 'var(--rpg-gold)' : isSuccess ? 'var(--rpg-heal)' : 'var(--rpg-ember)'}`,
          backdropFilter: 'blur(16px)',
        }}
      >
        {/* Dice type */}
        <p
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}
        >
          {currentRoll.type}
        </p>

        {/* Number */}
        <div
          className={cn(
            'text-6xl font-bold font-mono transition-all duration-300',
            phase === 'rolling' && 'animate-pulse scale-110',
          )}
          style={{
            color: isCritical
              ? 'var(--rpg-gold-bright)'
              : isSuccess
                ? 'var(--rpg-heal)'
                : 'var(--rpg-ember-bright)',
            fontFamily: "'Cinzel', serif",
            textShadow: isCritical
              ? '0 0 20px rgba(240, 201, 135, 0.5)'
              : 'none',
          }}
        >
          {displayNum}
        </div>

        {/* Target */}
        {phase === 'result' && (
          <div className="flex items-center gap-2 rpg-fade-in">
            <span className="text-xs" style={{ color: 'var(--rpg-text-dim)' }}>
              Target: {currentRoll.target}
            </span>
            {currentRoll.modifier !== 0 && (
              <span className="text-xs" style={{ color: 'var(--rpg-arcane)' }}>
                ({currentRoll.modifier > 0 ? '+' : ''}{currentRoll.modifier})
              </span>
            )}
          </div>
        )}

        {/* Result */}
        {phase === 'result' && (
          <div className="rpg-fade-in text-center">
            <p
              className="text-sm font-bold uppercase tracking-wider"
              style={{
                color: isCritical
                  ? 'var(--rpg-gold-bright)'
                  : isSuccess
                    ? 'var(--rpg-heal)'
                    : 'var(--rpg-ember-bright)',
                fontFamily: "'Cinzel', serif",
              }}
            >
              {isCritical ? '✨ CRITICAL!' : isSuccess ? '✓ Success' : '✗ Failed'}
            </p>
            {currentRoll.description && (
              <p
                className="text-xs mt-1 max-w-48"
                style={{ color: 'var(--rpg-text-dim)', fontFamily: "'Cormorant Garamond', serif" }}
              >
                {currentRoll.description}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
