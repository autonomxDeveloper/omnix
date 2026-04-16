import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import { storyApi } from '@/api/endpoints/audiobook'
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
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Pen, Sparkles, Loader2 } from 'lucide-react'

export function StoryDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [prompt, setPrompt] = useState('')
  const [genre, setGenre] = useState('fantasy')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  const isOpen = activeModal === 'story'

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setLoading(true)
    setProgress(10)
    try {
      await storyApi.generate({ prompt, genre })
      setProgress(100)
    } catch (err) {
      console.error('Story generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pen className="h-5 w-5" /> Story Teller
          </DialogTitle>
          <DialogDescription>Create immersive stories with AI voices and narration.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Genre</Label>
            <Select value={genre} onValueChange={setGenre}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fantasy">Fantasy</SelectItem>
                <SelectItem value="scifi">Sci-Fi</SelectItem>
                <SelectItem value="mystery">Mystery</SelectItem>
                <SelectItem value="horror">Horror</SelectItem>
                <SelectItem value="romance">Romance</SelectItem>
                <SelectItem value="adventure">Adventure</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Story Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the story you want to hear..."
              rows={5}
              className="mt-1"
            />
          </div>

          {progress > 0 && <Progress value={progress} />}

          <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Story
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
