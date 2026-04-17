/* RPG Theme - Dark Fantasy Design Tokens */
export const rpgColors = {
  bgDeep: '#0a0a1a',
  bgPanel: '#111128',
  bgCard: '#1a1a3e',
  bgSurface: '#252550',
  gold: '#d4a574',
  goldBright: '#f0c987',
  goldDim: '#8b6914',
  ember: '#c73e3e',
  emberBright: '#ff6b6b',
  arcane: '#4a7dff',
  arcaneDim: '#2a4a8f',
  heal: '#4ade80',
  mana: '#a78bfa',
  parchment: '#f5e6c8',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  border: '#2a2a5e',
  borderGold: 'rgba(212, 165, 116, 0.3)',
} as const

export const rarityColors: Record<string, string> = {
  common: '#9ca3af',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#f59e0b',
}

export const choiceTypeColors: Record<string, { bg: string; border: string; text: string }> = {
  combat: { bg: 'rgba(199, 62, 62, 0.15)', border: 'rgba(199, 62, 62, 0.4)', text: '#ff6b6b' },
  dialogue: { bg: 'rgba(74, 125, 255, 0.15)', border: 'rgba(74, 125, 255, 0.4)', text: '#7da7ff' },
  explore: { bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)', text: '#4ade80' },
  special: { bg: 'rgba(212, 165, 116, 0.15)', border: 'rgba(212, 165, 116, 0.4)', text: '#f0c987' },
}

export const dispositionColors: Record<string, string> = {
  friendly: '#4ade80',
  neutral: '#94a3b8',
  hostile: '#ff6b6b',
  fearful: '#a78bfa',
}
