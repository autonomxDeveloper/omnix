import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/stores/app-store'
import { useSessions, useDeleteSession } from '@/hooks/use-sessions'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { formatDate, truncate } from '@/lib/utils'
import { Trash2 } from 'lucide-react'

export function HistoryDialog() {
  const navigate = useNavigate()
  const { activeModal, closeModal } = useAppStore()
  const { data: sessions } = useSessions()
  const deleteSession = useDeleteSession()

  const isOpen = activeModal === 'history'

  const handleSelect = (id: string) => {
    navigate(`/chat/${id}`)
    closeModal()
  }

  return (
    <Dialog open={isOpen} onOpenChange={() => closeModal()}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Chat History</DialogTitle>
          <DialogDescription>Browse and manage your conversation history.</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          <div className="space-y-1">
            {(sessions || [])
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              .map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-2 rounded-lg p-3 hover:bg-muted/50 cursor-pointer group"
                  onClick={() => handleSelect(session.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{session.title || 'New Chat'}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(session.updated_at)} · {session.messages?.length || 0} messages
                    </p>
                    {session.messages?.[0] && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {truncate(session.messages[0].content, 60)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession.mutate(session.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            {(!sessions || sessions.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-8">No conversations yet</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
