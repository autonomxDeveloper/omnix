import { useLocation, useNavigate, useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useChatStore } from '@/stores/chat-store'
import { useHealth } from '@/hooks/use-health'
import { useModels } from '@/hooks/use-models'
import { StatusDot } from '@/components/shared/StatusDot'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatTokenCount } from '@/lib/utils'
import { Moon, Sun, Swords, MessageSquare, Mic, Square } from 'lucide-react'

export function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme, openModal } = useAppStore()
  const { settings, setModel, _hasHydrated } = useSettingsStore()
  const { isStreaming, inputTokens, outputTokens } = useChatStore()
  const { data: health } = useHealth()
  const { data: models } = useModels()

  const currentMode = location.pathname.startsWith('/rpg')
    ? 'rpg'
    : location.pathname.startsWith('/voice')
      ? 'voice'
      : 'chat'

  // Prevent flickering while localStorage loads
  useEffect(() => {
    // Force re-render after zustand persist hydration
  }, [settings.model])

  if (!_hasHydrated) {
    return null
  }

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      {/* Mode toggle */}
      <div className="flex items-center rounded-lg bg-muted p-0.5">
        <Button
          variant={currentMode === 'chat' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => navigate('/chat')}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Chat
        </Button>
        <Button
          variant={currentMode === 'rpg' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => navigate('/rpg')}
        >
          <Swords className="h-3.5 w-3.5" />
          RPG
        </Button>
        <Button
          variant={currentMode === 'voice' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => navigate('/voice')}
        >
          <Mic className="h-3.5 w-3.5" />
          Voice
        </Button>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-3">
        <StatusDot
          status={health?.llm?.connected ? 'connected' : 'disconnected'}
          label="LLM"
        />
        <StatusDot
          status={health?.tts?.connected ? 'connected' : 'disconnected'}
          label="TTS"
        />
        <StatusDot
          status={health?.stt?.connected ? 'connected' : 'disconnected'}
          label="STT"
        />
      </div>

      {/* Model selector */}
      <Select value={settings.model || ''} onValueChange={setModel} disabled={!settings.model}>
        <SelectTrigger className="h-8 w-48 text-xs">
          <SelectValue placeholder="Select model" />
        </SelectTrigger>
        <SelectContent>
          {/* Always show saved model first even if not in backend list */}
          {settings.model && !models?.find((m: any) => m.id === settings.model) && (
            <SelectItem key={settings.model} value={settings.model} className="text-xs">
              {settings.model}
            </SelectItem>
          )}
          {(models || []).map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              {m.name || m.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex-1" />

      {/* Token counter */}
      {(inputTokens > 0 || outputTokens > 0) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span>↑{formatTokenCount(inputTokens)}</span>
          <span>↓{formatTokenCount(outputTokens)}</span>
        </div>
      )}

      {/* Stop generation */}
      {isStreaming && (
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Square className="h-3 w-3" />
          Stop
        </Button>
      )}

      {/* Settings */}
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => openModal('settings')}>
        Settings
      </Button>

      {/* Theme toggle */}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </Button>
    </header>
  )
}
