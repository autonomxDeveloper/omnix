import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { AppHeader } from '@/components/header/AppHeader'

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  )
}
