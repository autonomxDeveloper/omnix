import { useState, useRef } from 'react'
import { useAppStore } from '@/stores/app-store'
import { audiobookApi } from '@/api/endpoints/audiobook'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, Sparkles, BookOpen, Loader2 } from 'lucide-react'

export function AudiobookDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const isOpen = activeModal === 'audiobook'

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)
    setLoading(true)
    try {
      const result = await audiobookApi.upload(formData)
      if (result.pages) setText(result.pages.join('\n\n'))
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerate = async () => {
    if (!text.trim()) return
    setLoading(true)
    setProgress(10)
    try {
      await audiobookApi.generate({ text })
      setProgress(100)
    } catch (err) {
      console.error('Generation failed:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" /> Audiobook Creator
          </DialogTitle>
          <DialogDescription>Convert text into professional audiobooks with AI voices.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="input">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="library">Library</TabsTrigger>
          </TabsList>

          <TabsContent value="input" className="space-y-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1" /> Upload File
              </Button>
              <input ref={fileRef} type="file" className="hidden" accept=".txt,.pdf,.epub" onChange={handleUpload} />
            </div>

            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or type your text here..."
              rows={10}
            />

            {progress > 0 && <Progress value={progress} />}

            <Button onClick={handleGenerate} disabled={loading || !text.trim()} className="w-full gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate Audiobook
            </Button>
          </TabsContent>

          <TabsContent value="library">
            <p className="text-sm text-muted-foreground text-center py-8">Your audiobook library will appear here</p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
