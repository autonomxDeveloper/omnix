import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { podcastApi } from '@/api/endpoints/audiobook'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Podcast, Sparkles, Loader2 } from 'lucide-react'

export function PodcastDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [topic, setTopic] = useState('')
  const [format, setFormat] = useState('conversation')
  const [length, setLength] = useState('medium')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  const isOpen = activeModal === 'podcast'

  const handleGenerate = async () => {
    if (!topic.trim()) return
    setLoading(true)
    setProgress(10)
    try {
      await podcastApi.generate({ topic, format, length })
      setProgress(100)
    } catch (err) {
      console.error('Podcast generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Podcast className="h-5 w-5" /> Podcast Creator
          </DialogTitle>
          <DialogDescription>Generate AI-powered podcast episodes on any topic.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Topic</Label>
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Enter a topic..." className="mt-1" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="conversation">Conversation</SelectItem>
                  <SelectItem value="interview">Interview</SelectItem>
                  <SelectItem value="debate">Debate</SelectItem>
                  <SelectItem value="educational">Educational</SelectItem>
                  <SelectItem value="storytelling">Storytelling</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Length</Label>
              <Select value={length} onValueChange={setLength}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">Short (~5 min)</SelectItem>
                  <SelectItem value="medium">Medium (~15 min)</SelectItem>
                  <SelectItem value="long">Long (~30 min)</SelectItem>
                  <SelectItem value="extended">Extended (~60 min)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {progress > 0 && <Progress value={progress} />}

          <Button onClick={handleGenerate} disabled={loading || !topic.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Podcast
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
