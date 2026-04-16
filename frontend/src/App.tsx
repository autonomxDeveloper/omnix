import { useEffect, lazy, Suspense } from 'react'
import { useAppStore } from './stores/app-store'
import { AppLayout } from './layouts/AppLayout'
import { ChatView } from './components/chat/ChatView'
import { SettingsDialog } from './components/modals/SettingsDialog'
import { HistoryDialog } from './components/modals/HistoryDialog'
import { SearchDialog } from './components/modals/SearchDialog'
import { AudiobookDialog } from './components/modals/AudiobookDialog'
import { PodcastDialog } from './components/modals/PodcastDialog'
import { StoryDialog } from './components/modals/StoryDialog'
import { VoiceStudioDialog } from './components/modals/VoiceStudioDialog'
import { VoiceCloneDialog } from './components/modals/VoiceCloneDialog'
import { LoadingSpinner } from './components/shared/LoadingSpinner'

const RpgView = lazy(() => import('./components/rpg/RpgView').then((m) => ({ default: m.RpgView })))

function App() {
  const { theme, mode } = useAppStore()

  // Apply theme on mount
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <AppLayout>
      {/* Main content based on mode */}
      {mode === 'chat' && <ChatView />}
      {mode === 'rpg' && (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner size="lg" />
            </div>
          }
        >
          <RpgView />
        </Suspense>
      )}

      {/* Modals */}
      <SettingsDialog />
      <HistoryDialog />
      <SearchDialog />
      <AudiobookDialog />
      <PodcastDialog />
      <StoryDialog />
      <VoiceStudioDialog />
      <VoiceCloneDialog />
    </AppLayout>
  )
}

export default App
