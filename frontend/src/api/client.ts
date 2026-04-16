/* Shared API client - base fetch wrapper */

const BASE_URL = ''

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let data: unknown
    try {
      data = await response.json()
    } catch {
      // ignore
    }
    throw new ApiError(
      response.status,
      (data as { error?: string })?.error || response.statusText,
      data,
    )
  }
  const contentType = response.headers.get('content-type')
  if (contentType?.includes('application/json')) {
    return response.json()
  }
  return response.text() as unknown as T
}

function buildHeaders(custom?: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (custom) Object.assign(headers, custom)
  return headers
}

export const api = {
  async get<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers: buildHeaders(options?.headers),
    })
    return handleResponse<T>(res)
  },

  async post<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async put<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: buildHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
    })
    return handleResponse<T>(res)
  },

  async delete<T>(path: string, options?: { headers?: Record<string, string> }): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: buildHeaders(options?.headers),
    })
    return handleResponse<T>(res)
  },

  async postStream(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<ReadableStream<Uint8Array> | null> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(options?.headers),
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    })
    if (!res.ok) {
      let data: unknown
      try {
        data = await res.json()
      } catch {
        // ignore
      }
      throw new ApiError(
        res.status,
        (data as { error?: string })?.error || res.statusText,
        data,
      )
    }
    return res.body
  },

  async postFormData<T>(path: string, formData: FormData): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      body: formData,
    })
    return handleResponse<T>(res)
  },
}
