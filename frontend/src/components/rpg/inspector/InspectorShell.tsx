import { useState } from 'react'
import { useRpgStore } from '@/stores/rpg-store'
import { rpgInspectorApi } from '@/api/endpoints/rpg-presentation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { X, RefreshCw } from 'lucide-react'

export function InspectorShell() {
  const { setInspectorOpen, sessionId } = useRpgStore()
  const [timelineData, setTimelineData] = useState<unknown>(null)
  const [npcData, setNpcData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const loadTimeline = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const data = await rpgInspectorApi.timeline(sessionId)
      setTimelineData(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadNpcReasoning = async () => {
    if (!sessionId) return
    setLoading(true)
    try {
      const data = await rpgInspectorApi.npcReasoning(sessionId)
      setNpcData(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed bottom-0 right-0 z-30 flex flex-col overflow-hidden rounded-tl-xl"
      style={{
        width: '50%',
        height: '60%',
        background: 'rgba(10, 10, 26, 0.95)',
        border: '1px solid var(--rpg-border)',
        borderRight: 'none',
        borderBottom: 'none',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: 'var(--rpg-border)' }}>
        <span className="text-xs font-mono" style={{ color: 'var(--rpg-arcane)' }}>
          🔍 Inspector
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setInspectorOpen(false)}>
          <X className="h-3.5 w-3.5" style={{ color: 'var(--rpg-text-dim)' }} />
        </Button>
      </div>

      <Tabs defaultValue="timeline" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-3 mt-2" style={{ background: 'rgba(37, 37, 80, 0.3)' }}>
          <TabsTrigger value="timeline" className="text-[10px]">Timeline</TabsTrigger>
          <TabsTrigger value="npcs" className="text-[10px]">NPC Reasoning</TabsTrigger>
          <TabsTrigger value="gm" className="text-[10px]">GM Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="timeline" className="flex-1 overflow-hidden m-0">
          <div className="flex items-center gap-2 px-3 py-2">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={loadTimeline} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" /> Load
            </Button>
          </div>
          <ScrollArea className="flex-1 h-full px-3 pb-3">
            {timelineData ? (
              <pre className="text-[10px] font-mono" style={{ color: 'var(--rpg-text-dim)' }}>
                {JSON.stringify(timelineData, null, 2)}
              </pre>
            ) : (
              <p className="text-[10px] text-center py-4" style={{ color: 'var(--rpg-text-dim)' }}>
                Click Load to fetch timeline data
              </p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="npcs" className="flex-1 overflow-hidden m-0">
          <div className="flex items-center gap-2 px-3 py-2">
            <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={loadNpcReasoning} disabled={loading}>
              <RefreshCw className="h-3 w-3 mr-1" /> Load
            </Button>
          </div>
          <ScrollArea className="flex-1 h-full px-3 pb-3">
            {npcData ? (
              <pre className="text-[10px] font-mono" style={{ color: 'var(--rpg-text-dim)' }}>
                {JSON.stringify(npcData, null, 2)}
              </pre>
            ) : (
              <p className="text-[10px] text-center py-4" style={{ color: 'var(--rpg-text-dim)' }}>
                Click Load to fetch NPC reasoning data
              </p>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="gm" className="flex-1 overflow-hidden m-0">
          <ScrollArea className="h-full px-3 py-3">
            <p className="text-[10px] text-center py-4" style={{ color: 'var(--rpg-text-dim)' }}>
              GM audit data will appear here
            </p>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}
