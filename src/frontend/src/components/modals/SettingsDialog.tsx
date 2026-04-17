import { useAppStore } from '@/stores/app-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'

const OPENROUTER_MODELS = [
  { value: 'openrouter/anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
  { value: 'openrouter/anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
  { value: 'openrouter/anthropic/claude-3-opus', label: 'Claude 3 Opus' },
  { value: 'openrouter/openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openrouter/openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'openrouter/openai/gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'openrouter/google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { value: 'openrouter/google/gemini-2.0-pro', label: 'Gemini 2.0 Pro' },
  { value: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
  { value: 'openrouter/meta-llama/llama-3.1-405b-instruct', label: 'Llama 3.1 405B' },
  { value: 'openrouter/mistralai/mistral-large-2', label: 'Mistral Large 2' },
  { value: 'openrouter/deepseek/deepseek-v3', label: 'DeepSeek V3' },
  { value: 'openrouter/cohere/command-r-plus', label: 'Command R+' },
  { value: 'openrouter/qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  { value: 'openrouter/perplexity/sonar-reasoning', label: 'Perplexity Sonar' },
]
import { SYSTEM_PROMPT_PRESETS } from '@/types/settings'
import type { Provider } from '@/types/settings'

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'llamacpp', label: 'llama.cpp' },
]

export function SettingsDialog() {
  const { activeModal, closeModal } = useAppStore()
  const { settings, setSettings, setProvider, setSystemPrompt } = useSettingsStore()

  const isOpen = activeModal === 'settings'

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your AI provider, models, and preferences.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="provider">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="provider">Provider</TabsTrigger>
            <TabsTrigger value="generation">Generation</TabsTrigger>
            <TabsTrigger value="system">System Prompt</TabsTrigger>
          </TabsList>

          {/* Provider tab */}
          <TabsContent value="provider" className="space-y-4">
            <div>
              <Label>Provider</Label>
              <Select value={settings.provider} onValueChange={(v) => setProvider(v as Provider)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>API URL</Label>
              <Input
                value={settings.api_url || ''}
                onChange={(e) => setSettings({ api_url: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="mt-1"
              />
            </div>

            <div>
              <Label>API Key</Label>
              <Input
                type="password"
                value={settings.api_key || ''}
                onChange={(e) => setSettings({ api_key: e.target.value })}
                placeholder="sk-..."
                className="mt-1"
              />
            </div>

            <div>
              <Label>Model</Label>
              <Combobox
                value={settings.model || ''}
                onChange={(v) => setSettings({ model: v })}
                options={OPENROUTER_MODELS}
                placeholder="Select or type a model..."
                emptyMessage="No models found. Type to enter custom model."
                allowCustomValue={true}
              />
            </div>
          </TabsContent>

          {/* Generation tab */}
          <TabsContent value="generation" className="space-y-4">
            <div>
              <div className="flex justify-between">
                <Label>Temperature</Label>
                <span className="text-xs text-muted-foreground">{settings.temperature}</span>
              </div>
              <Slider
                value={[settings.temperature]}
                onValueChange={([v]) => setSettings({ temperature: v })}
                min={0}
                max={2}
                step={0.1}
                className="mt-2"
              />
            </div>

            <div>
              <div className="flex justify-between">
                <Label>Max Tokens</Label>
                <span className="text-xs text-muted-foreground">{settings.max_tokens}</span>
              </div>
              <Slider
                value={[settings.max_tokens]}
                onValueChange={([v]) => setSettings({ max_tokens: v })}
                min={256}
                max={32768}
                step={256}
                className="mt-2"
              />
            </div>

            <div>
              <div className="flex justify-between">
                <Label>Context Length</Label>
                <span className="text-xs text-muted-foreground">{settings.context_length}</span>
              </div>
              <Slider
                value={[settings.context_length]}
                onValueChange={([v]) => setSettings({ context_length: v })}
                min={1024}
                max={131072}
                step={1024}
                className="mt-2"
              />
            </div>
          </TabsContent>

          {/* System prompt tab */}
          <TabsContent value="system" className="space-y-4">
            <div>
              <Label>Preset</Label>
              <Select
                value=""
                onValueChange={(v) => setSystemPrompt(SYSTEM_PROMPT_PRESETS[v] || '')}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Choose a preset..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SYSTEM_PROMPT_PRESETS).map(([key, val]) => (
                    <SelectItem key={key} value={key}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Custom System Prompt</Label>
              <Textarea
                value={settings.system_prompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={8}
                className="mt-1"
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
