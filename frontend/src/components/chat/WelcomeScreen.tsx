import { MessageSquare, Swords, BookOpen, Mic2 } from 'lucide-react'

export function WelcomeScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
          O
        </div>
        <h1 className="text-2xl font-bold">Omnix</h1>
      </div>
      <p className="text-muted-foreground text-center max-w-md">
        Your all-in-one AI assistant. Chat, create audiobooks, podcasts, stories, or embark on RPG adventures.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        <FeatureCard icon={MessageSquare} label="AI Chat" desc="Conversational AI" />
        <FeatureCard icon={Swords} label="RPG Mode" desc="Fantasy adventures" />
        <FeatureCard icon={BookOpen} label="Audiobooks" desc="Text to audio" />
        <FeatureCard icon={Mic2} label="Voice" desc="Real-time voice" />
      </div>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  label,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  desc: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}
