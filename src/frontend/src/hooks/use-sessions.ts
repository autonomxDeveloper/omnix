import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '@/api/endpoints/chat'
import type { ChatSession } from '@/types/chat'

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: chatApi.getSessions,
  })
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: () => chatApi.getSession(id!),
    enabled: !!id,
  })
}

export function useCreateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: chatApi.createSession,
    onSuccess: (data) => {
      queryClient.setQueryData<ChatSession[]>(['sessions'], (old) => {
        const session = data.session || data
        return old ? [session, ...old] : [session]
      })
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: chatApi.deleteSession,
    onSuccess: (_data, id) => {
      queryClient.setQueryData<ChatSession[]>(['sessions'], (old) =>
        old ? old.filter((s) => s.id !== id) : [],
      )
    },
  })
}

export function useUpdateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ChatSession> }) =>
      chatApi.updateSession(id, data),
    onSuccess: (session) => {
      queryClient.setQueryData<ChatSession[]>(['sessions'], (old) =>
        old ? old.map((s) => (s.id === session.id ? session : s)) : [],
      )
    },
  })
}
