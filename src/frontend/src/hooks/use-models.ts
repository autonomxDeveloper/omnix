import { useQuery } from '@tanstack/react-query'
import { modelsApi } from '@/api/endpoints/models'

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: modelsApi.list,
    staleTime: 60_000,
  })
}

export function useLLMModels() {
  return useQuery({
    queryKey: ['llm-models'],
    queryFn: modelsApi.listLLM,
    staleTime: 60_000,
  })
}
