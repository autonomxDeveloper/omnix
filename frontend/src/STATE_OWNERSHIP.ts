/**
 * State Ownership Rules
 * ====================
 *
 * This file documents the hard ownership boundaries between state management layers.
 * Every piece of state in the frontend should belong to exactly one owner.
 *
 * ─── TanStack Query (server state) ───────────────────────────
 * Owns: All data fetched from the server.
 *   - Chat sessions and message history    → useSession(), useSessions()
 *   - RPG session state                    → useRpgSession()
 *   - RPG session list                     → useRpgSessions()
 *   - Models list                          → useModels()
 *   - Health status                        → useHealth()
 *   - Speaker list                         → useSpeakers()
 *
 * Rules:
 *   - Components read server data from query hooks, never from Zustand.
 *   - Mutations invalidate relevant query keys; components re-render from cache.
 *   - Never copy fetched data into a Zustand store.
 *
 * ─── Zustand (ephemeral UI/interaction state) ────────────────
 * Owns: State that is purely client-side and does not persist on the server.
 *   - app-store:        theme, sidebarOpen, activeModal
 *   - chat-store:       isStreaming, streamingContent, pendingUserMessage, token counts
 *   - rpg-store:        isTurnLoading, pendingRolls (dice animations), streamingNarration,
 *                        UI panel toggles (inspector, character sheet, dialogue, builder)
 *   - rpg-player-store: player stats snapshot (updated each turn from mutation result)
 *   - settings-store:   user preferences (persisted to localStorage, not server-fetched)
 *
 * Rules:
 *   - Zustand stores must NOT hold server-fetched data.
 *   - Zustand stores hold interaction state (streaming buffers, UI toggles, animations).
 *   - Player stats in rpg-player-store are updated from mutation results, not duplicated
 *     from query cache.
 *
 * ─── Transport hooks (streaming lifecycle) ───────────────────
 * Owns: Connection lifecycle, parsing, reconnect, abort handling.
 *   - useChatStream:  SSE line parsing, abort controller, stream lifecycle for chat
 *   - useRpgTurn:     Turn mutation lifecycle, result distribution, cache invalidation
 *   - WebSocketAdapter (api/websocket.ts): WS connection, reconnect, binary support
 *   - createSSEStream / streamFetch (api/sse.ts): reusable SSE stream primitives
 *
 * Rules:
 *   - SSE/stream parsing code lives in hooks or api/ adapters, never in UI components.
 *   - Hooks update Zustand ephemeral state (streaming buffers) during streaming.
 *   - Hooks invalidate TanStack Query cache on stream/mutation completion.
 *   - Components call hook methods (send, abort, executeTurn) and read derived state.
 *
 * ─── React Router (navigation state) ────────────────────────
 * Owns: Current page, active session ID, mode selection.
 *   - /chat              → Chat view (new conversation)
 *   - /chat/:sessionId   → Chat view with specific session
 *   - /rpg               → RPG welcome/start screen
 *   - /rpg/:sessionId    → RPG game session
 *   - /voice             → Voice conversation mode
 *
 * Rules:
 *   - Navigation is always through route changes, never through store mode flags.
 *   - Session ID comes from URL params, not from Zustand.
 *   - The header/sidebar derive "current mode" from the URL pathname.
 */
export {}
