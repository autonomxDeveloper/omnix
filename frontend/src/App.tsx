import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
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
const VoiceView = lazy(() => import('./components/voice/VoiceView').then((m) => ({ default: m.VoiceView })))

const SuspenseFallback = (
  <div className="flex h-full items-center justify-center">
    <LoadingSpinner size="lg" />
  </div>
)

function App() {
  const { theme } = useAppStore()

  // Apply theme on mount and change
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <AppLayout>
      {/* Routed content */}
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/chat/:sessionId" element={<ChatView />} />
        <Route
          path="/rpg"
          element={<Suspense fallback={SuspenseFallback}><RpgView /></Suspense>}
        />
        <Route
          path="/rpg/:sessionId"
          element={<Suspense fallback={SuspenseFallback}><RpgView /></Suspense>}
        />
        <Route
          path="/voice"
          element={<Suspense fallback={SuspenseFallback}><VoiceView /></Suspense>}
        />
        {/* Catch-all: redirect to chat */}
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>

      {/* Modals (rendered globally, opened via Zustand) */}
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
