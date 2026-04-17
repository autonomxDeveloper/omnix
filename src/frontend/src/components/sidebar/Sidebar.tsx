import { useLocation, useNavigate } from 'react-router-dom'
import { useAppStore } from '@/stores/app-store'
import { useSessions, useCreateSession, useDeleteSession } from '@/hooks/use-sessions'
import { useRpgStore } from '@/stores/rpg-store'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { truncate, formatDate } from '@/lib/utils'
import {
  MessageSquarePlus,
  Search,
  History,
  Settings,
  BookOpen,
  Mic2,
  BookHeadphones,
  Podcast,
  Pen,
  Swords,
  Mic,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'

export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { sidebarOpen, toggleSidebar, openModal } = useAppStore()
  const { data: sessions } = useSessions()
  const createSession = useCreateSession()
  const deleteSession = useDeleteSession()
  const rpgStore = useRpgStore()

  const currentMode = location.pathname.startsWith('/rpg')
    ? 'rpg'
    : location.pathname.startsWith('/voice')
      ? 'voice'
      : 'chat'

  // Extract active chat session ID from URL
  const activeSessionId = location.pathname.startsWith('/chat/')
    ? location.pathname.split('/chat/')[1]
    : null

  const handleNewChat = () => {
    createSession.mutate(undefined, {
      onSuccess: (session) => {
        if (session && session.id) {
          navigate(`/chat/${session.id}`)
        } else {
          // Fallback if no session returned - go to root chat page
          navigate('/chat')
        }
      },
    })
  }

  const handleSelectSession = (id: string) => {
    navigate(`/chat/${id}`)
  }

  const toolItems = [
    { icon: Settings, label: 'Settings', modal: 'settings' as const },
    { icon: Mic2, label: 'Voice Clone', modal: 'voice-clone' as const },
    { icon: BookHeadphones, label: 'Audiobook', modal: 'audiobook' as const },
    { icon: Podcast, label: 'Podcast', modal: 'podcast' as const },
    { icon: Pen, label: 'Story Teller', modal: 'story' as const },
    { icon: BookOpen, label: 'Voice Studio', modal: 'voice-studio' as const },
  ]

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-sidebar-border bg-sidebar-background transition-all duration-300',
        sidebarOpen ? 'w-64' : 'w-14',
      )}
    >
      {/* Header */}
      <div className="flex h-14 items-center gap-2 px-3">
        {sidebarOpen && (
          <div className="flex flex-1 items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">
              O
            </div>
            <span className="font-semibold text-sm">Omnix</span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8 shrink-0">
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-1 px-2">
        <SidebarButton icon={MessageSquarePlus} label="New Chat" collapsed={!sidebarOpen} onClick={handleNewChat} />
        <SidebarButton icon={Search} label="Search" collapsed={!sidebarOpen} onClick={() => openModal('search')} />
        <SidebarButton icon={History} label="History" collapsed={!sidebarOpen} onClick={() => openModal('history')} />
        <SidebarButton
          icon={Swords}
          label="RPG Mode"
          collapsed={!sidebarOpen}
          active={currentMode === 'rpg'}
          onClick={() => {
            if (currentMode === 'rpg') {
              navigate('/chat')
            } else {
              rpgStore.setAdventureBuilderOpen(false)
              navigate('/rpg')
            }
          }}
        />
        <SidebarButton
          icon={Mic}
          label="Voice Mode"
          collapsed={!sidebarOpen}
          active={currentMode === 'voice'}
          onClick={() => {
            navigate(currentMode === 'voice' ? '/chat' : '/voice')
          }}
        />
      </div>

      <Separator className="my-2" />

      {/* Session list */}
      {sidebarOpen && (
        <ScrollArea className="flex-1 px-2">
          <div className="flex flex-col gap-0.5 py-1">
            {(sessions || [])
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
              .map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent',
                    activeSessionId === session.id && 'bg-sidebar-accent text-sidebar-accent-foreground',
                  )}
                >
                  <span className="flex-1 truncate">{truncate(session.title || 'New Chat', 28)}</span>
                  <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
                    {formatDate(session.updated_at)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSession.mutate(session.id)
                    }}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"
                  >
                    ×
                  </button>
                </button>
              ))}
          </div>
        </ScrollArea>
      )}

      {/* Tools */}
      <Separator className="my-2" />
      <div className="flex flex-col gap-1 px-2 pb-3">
        {toolItems.map((item) => (
          <SidebarButton
            key={item.label}
            icon={item.icon}
            label={item.label}
            collapsed={!sidebarOpen}
            onClick={() => openModal(item.modal)}
          />
        ))}
      </div>
    </aside>
  )
}

function SidebarButton({
  icon: Icon,
  label,
  collapsed,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  collapsed: boolean
  active?: boolean
  onClick: () => void
}) {
  const button = (
    <Button
      variant={active ? 'secondary' : 'ghost'}
      size={collapsed ? 'icon' : 'sm'}
      className={cn('w-full', !collapsed && 'justify-start gap-2')}
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Button>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return button
}
