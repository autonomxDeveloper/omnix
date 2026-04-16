import { useRef, useEffect } from 'react'
import type { RpgWorld, RpgRegion, RpgFaction } from '@/types/rpg'

interface MinimapProps {
  world?: RpgWorld | null
}

export function Minimap({ world }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !world) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = canvas.width
    const h = canvas.height

    // Background
    ctx.fillStyle = '#0d0d2b'
    ctx.fillRect(0, 0, w, h)

    // Grid
    ctx.strokeStyle = 'rgba(42, 42, 94, 0.4)'
    ctx.lineWidth = 0.5
    for (let x = 0; x <= w; x += 20) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
    for (let y = 0; y <= h; y += 20) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Fog of war overlay
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2)
    gradient.addColorStop(0, 'transparent')
    gradient.addColorStop(0.7, 'transparent')
    gradient.addColorStop(1, 'rgba(10, 10, 26, 0.8)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)

    // Regions
    if (world.regions) {
      world.regions.forEach((region: RpgRegion) => {
        if (!region.discovered) return

        const rx = ((region.x + 50) / 100) * w
        const ry = ((region.y + 50) / 100) * h

        // Region dot
        ctx.beginPath()
        ctx.arc(rx, ry, 6, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(74, 125, 255, 0.3)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(74, 125, 255, 0.6)'
        ctx.lineWidth = 1
        ctx.stroke()

        // Label
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)'
        ctx.font = '8px "Cinzel", serif'
        ctx.textAlign = 'center'
        ctx.fillText(region.name, rx, ry + 14)
      })
    }

    // Faction territories
    if (world.factions) {
      world.factions.forEach((faction: RpgFaction) => {
        // Simple territory indicator
        ctx.fillStyle = faction.color + '20'
      })
    }

    // Player marker with glow
    const px = w / 2
    const py = h / 2

    // Glow
    const playerGlow = ctx.createRadialGradient(px, py, 0, px, py, 12)
    playerGlow.addColorStop(0, 'rgba(240, 201, 135, 0.6)')
    playerGlow.addColorStop(1, 'transparent')
    ctx.fillStyle = playerGlow
    ctx.fillRect(px - 12, py - 12, 24, 24)

    // Player dot
    ctx.beginPath()
    ctx.arc(px, py, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#f0c987'
    ctx.fill()
    ctx.strokeStyle = '#d4a574'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [world])

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
          World Map
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={224}
        height={160}
        className="w-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
