import { useState, useRef } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Mic2, Upload, Loader2 } from 'lucide-react'

export function VoiceCloneDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const isOpen = activeModal === 'voice-clone'

  const handleClone = async () => {
    if (!file || !name.trim()) return
    setLoading(true)
    setStatus('Processing...')
    try {
      const formData = new FormData()
      formData.append('audio', file)
      formData.append('name', name)
      await voiceApi.createClone(formData)
      setStatus('Voice cloned successfully!')
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic2 className="h-5 w-5" /> Voice Clone
          </DialogTitle>
          <DialogDescription>Create a custom voice clone from an audio sample.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Voice Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My custom voice" className="mt-1" />
          </div>

          <div>
            <Label>Audio Sample</Label>
            <div className="mt-1">
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />
                {file ? file.name : 'Choose audio file'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                accept="audio/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">Upload a 10-30 second audio clip</p>
          </div>

          {status && <p className="text-sm text-muted-foreground">{status}</p>}

          <Button onClick={handleClone} disabled={loading || !file || !name.trim()} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic2 className="h-4 w-4" />}
            Clone Voice
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
