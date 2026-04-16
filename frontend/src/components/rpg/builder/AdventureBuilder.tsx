import { useState } from 'react'
import { useRpgStore } from '@/stores/rpg-store'
import { useRpgPlayerStore } from '@/stores/rpg-player-store'
import { rpgAdventureApi } from '@/api/endpoints/rpg-adventure'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ArrowLeft, ArrowRight, Sparkles, Loader2 } from 'lucide-react'

const STEPS = [
  { id: 'theme', title: 'Theme & Tone', icon: '🎭' },
  { id: 'protagonist', title: 'Your Hero', icon: '⚔️' },
  { id: 'world', title: 'World', icon: '🌍' },
  { id: 'conflicts', title: 'Conflicts', icon: '💥' },
  { id: 'npcs', title: 'NPCs', icon: '👥' },
  { id: 'rules', title: 'Rules', icon: '📜' },
  { id: 'review', title: 'Launch', icon: '🚀' },
]

export function AdventureBuilder() {
  const rpgStore = useRpgStore()
  const rpgPlayerStore = useRpgPlayerStore()
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    theme: 'dark_fantasy',
    tone: 'epic',
    setting: '',
    hero_name: '',
    hero_background: '',
    world_desc: '',
    conflict: '',
    npcs_desc: '',
    difficulty: 'normal',
  })

  const updateForm = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleLaunch = async () => {
    setLoading(true)
    try {
      const result = await rpgAdventureApi.start({
        setup: form,
      }) as Record<string, unknown>

      if (result.session_id) {
        rpgStore.setSessionId(result.session_id as string)
        rpgStore.setAdventureBuilderOpen(false)
        if (result.narration) {
          rpgStore.addNarration({ type: 'narration', content: result.narration as string, turn: 0 })
        }
        if (result.choices) rpgStore.setChoices(result.choices as typeof rpgStore.choices)
        if (result.player) rpgPlayerStore.setPlayer(result.player as Record<string, unknown> as typeof rpgPlayerStore.player)
      }
    } catch (err) {
      console.error('Failed to launch adventure:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rpg-theme flex h-full flex-col" style={{ background: 'var(--rpg-bg-deep)' }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b" style={{ borderColor: 'var(--rpg-border)' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => rpgStore.setAdventureBuilderOpen(false)}
          style={{ color: 'var(--rpg-text-dim)' }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <h2 style={{ fontFamily: "'Cinzel', serif", color: 'var(--rpg-gold)', fontSize: '1.1rem' }}>
          Adventure Builder
        </h2>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 py-3 px-6">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => setStep(i)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] transition-all"
              style={{
                background: i === step ? 'rgba(212, 165, 116, 0.2)' : 'transparent',
                border: `1px solid ${i === step ? 'var(--rpg-border-gold)' : 'transparent'}`,
                color: i <= step ? 'var(--rpg-gold)' : 'var(--rpg-text-dim)',
                fontFamily: "'Cinzel', serif",
              }}
            >
              <span>{s.icon}</span>
              <span className="hidden sm:inline">{s.title}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="w-4 h-px mx-1" style={{ background: i < step ? 'var(--rpg-gold-dim)' : 'var(--rpg-border)' }} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <ScrollArea className="flex-1">
        <div className="max-w-xl mx-auto p-6 space-y-4">
          {step === 0 && (
            <>
              <FormField label="Theme" value={form.theme} onChange={(v) => updateForm('theme', v)} placeholder="e.g., dark_fantasy, sci_fi, steampunk" />
              <FormField label="Tone" value={form.tone} onChange={(v) => updateForm('tone', v)} placeholder="e.g., epic, gritty, comedic" />
              <FormTextarea label="Setting Description" value={form.setting} onChange={(v) => updateForm('setting', v)} placeholder="Describe the world your adventure takes place in..." />
            </>
          )}
          {step === 1 && (
            <>
              <FormField label="Hero Name" value={form.hero_name} onChange={(v) => updateForm('hero_name', v)} placeholder="Your character's name" />
              <FormTextarea label="Background" value={form.hero_background} onChange={(v) => updateForm('hero_background', v)} placeholder="Your character's backstory, goals, and abilities..." />
            </>
          )}
          {step === 2 && (
            <FormTextarea label="World Description" value={form.world_desc} onChange={(v) => updateForm('world_desc', v)} placeholder="Key locations, factions, and lore..." rows={8} />
          )}
          {step === 3 && (
            <FormTextarea label="Conflicts & Quests" value={form.conflict} onChange={(v) => updateForm('conflict', v)} placeholder="Main conflict, side quests, stakes..." rows={6} />
          )}
          {step === 4 && (
            <FormTextarea label="Key NPCs" value={form.npcs_desc} onChange={(v) => updateForm('npcs_desc', v)} placeholder="Describe important characters, their roles, and relationships..." rows={6} />
          )}
          {step === 5 && (
            <FormField label="Difficulty" value={form.difficulty} onChange={(v) => updateForm('difficulty', v)} placeholder="easy, normal, hard, nightmare" />
          )}
          {step === 6 && (
            <div className="space-y-4">
              <p style={{ color: 'var(--rpg-text)', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.05rem' }}>
                Review your adventure settings and launch when ready.
              </p>
              <div className="rounded-lg p-4" style={{ background: 'rgba(37, 37, 80, 0.3)', border: '1px solid var(--rpg-border)' }}>
                <pre className="text-[10px] font-mono overflow-auto" style={{ color: 'var(--rpg-text-dim)' }}>
                  {JSON.stringify(form, null, 2)}
                </pre>
              </div>
              <Button
                className="w-full gap-2"
                onClick={handleLaunch}
                disabled={loading}
                style={{
                  background: 'linear-gradient(135deg, var(--rpg-gold-dim), var(--rpg-gold))',
                  color: 'var(--rpg-bg-deep)',
                  fontFamily: "'Cinzel', serif",
                }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Launch Adventure
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Navigation */}
      <div className="flex items-center justify-between px-6 py-3 border-t" style={{ borderColor: 'var(--rpg-border)' }}>
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0}
          onClick={() => setStep(step - 1)}
          style={{ color: 'var(--rpg-text-dim)' }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Previous
        </Button>
        {step < STEPS.length - 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep(step + 1)}
            style={{ color: 'var(--rpg-gold)' }}
          >
            Next <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}

function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}>
        {label}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-0 text-sm"
        style={{ background: 'rgba(37, 37, 80, 0.4)', color: 'var(--rpg-text)' }}
      />
    </div>
  )
}

function FormTextarea({ label, value, onChange, placeholder, rows = 4 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; rows?: number
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--rpg-gold-dim)', fontFamily: "'Cinzel', serif" }}>
        {label}
      </label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="border-0 text-sm resize-none"
        style={{
          background: 'rgba(37, 37, 80, 0.4)',
          color: 'var(--rpg-text)',
          fontFamily: "'Cormorant Garamond', serif",
        }}
      />
    </div>
  )
}
