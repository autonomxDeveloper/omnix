import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { voiceApi } from '@/api/endpoints/voice'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Volume2, Loader2, Play } from 'lucide-react'

const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'dramatic']

export function VoiceStudioDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [text, setText] = useState('')
  const [emotion, setEmotion] = useState('neutral')
  const [speed, setSpeed] = useState(1.0)
  const [pitch, setPitch] = useState(1.0)
  const [voice, setVoice] = useState('')
  const [loading, setLoading] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const isOpen = activeModal === 'voice-studio'

  const handleGenerate = async () => {
    if (!text.trim()) return
    setLoading(true)
    try {
      const blob = await voiceApi.studioGenerate({ text, voice, emotion, speed, pitch })
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
    } catch (err) {
      console.error('Voice generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" /> Voice Studio
          </DialogTitle>
          <DialogDescription>Generate speech with precise emotion and voice control.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Text</Label>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter text to speak..." rows={4} className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Emotion</Label>
              <Select value={emotion} onValueChange={setEmotion}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EMOTIONS.map((e) => (
                    <SelectItem key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Voice</Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Default" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex justify-between">
              <Label>Speed</Label>
              <span className="text-xs text-muted-foreground">{speed.toFixed(1)}x</span>
            </div>
            <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={0.5} max={2.0} step={0.1} className="mt-2" />
          </div>

          <div>
            <div className="flex justify-between">
              <Label>Pitch</Label>
              <span className="text-xs text-muted-foreground">{pitch.toFixed(1)}x</span>
            </div>
            <Slider value={[pitch]} onValueChange={([v]) => setPitch(v)} min={0.5} max={2.0} step={0.1} className="mt-2" />
          </div>

          {audioUrl && (
            <audio controls src={audioUrl} className="w-full" />
          )}

          <Button onClick={handleGenerate} disabled={loading || !text.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Generate Speech
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
