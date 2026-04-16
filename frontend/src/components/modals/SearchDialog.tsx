import { useState } from 'react'
import { useAppStore } from '@/stores/app-store'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

export function SearchDialog() {
  const { activeModal, closeModal } = useAppStore()
  const [query, setQuery] = useState('')

  const isOpen = activeModal === 'search'

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Search Conversations</DialogTitle>
          <DialogDescription>Search across all your chat history.</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages..."
            className="pl-10"
            autoFocus
          />
        </div>

        <div className="min-h-[200px] flex items-center justify-center">
          {query ? (
            <p className="text-sm text-muted-foreground">Searching for &ldquo;{query}&rdquo;...</p>
          ) : (
            <p className="text-sm text-muted-foreground">Type to search across your conversations</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
