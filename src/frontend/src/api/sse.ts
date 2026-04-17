/* SSE (Server-Sent Events) adapter */

export interface SSEOptions {
  onMessage: (data: string) => void
  onError?: (error: Event) => void
  onOpen?: () => void
  onComplete?: () => void
}

export function createSSEStream(
  url: string,
  body: unknown,
  options: SSEOptions,
): AbortController {
  const controller = new AbortController()

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        options.onError?.(new Event('error'))
        return
      }
      options.onOpen?.()

      const reader = response.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') {
              options.onComplete?.()
              return
            }
            options.onMessage(data)
          }
        }
      }

      options.onComplete?.()
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        options.onError?.(err)
      }
    })

  return controller
}

/* ReadableStream-based streaming for chat */
export async function streamFetch(
  url: string,
  body: unknown,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw new Error(`Stream failed: ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) return

  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    onChunk(text)
  }
}
