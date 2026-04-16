/* WebSocket adapter with reconnect and binary PCM support */

export interface WSOptions {
  url: string
  onMessage?: (data: string | ArrayBuffer) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  binaryType?: BinaryType
}

export class WebSocketAdapter {
  private ws: WebSocket | null = null
  private options: Required<WSOptions>
  private reconnectCount = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private manualClose = false

  constructor(options: WSOptions) {
    this.options = {
      reconnect: true,
      reconnectInterval: 2000,
      maxReconnectAttempts: 5,
      binaryType: 'arraybuffer',
      onMessage: () => {},
      onOpen: () => {},
      onClose: () => {},
      onError: () => {},
      ...options,
    }
  }

  connect(): void {
    this.manualClose = false
    this.ws = new WebSocket(this.options.url)
    this.ws.binaryType = this.options.binaryType

    this.ws.onopen = () => {
      this.reconnectCount = 0
      this.options.onOpen()
    }

    this.ws.onmessage = (event) => {
      this.options.onMessage(event.data)
    }

    this.ws.onclose = () => {
      this.options.onClose()
      if (!this.manualClose && this.options.reconnect) {
        this.tryReconnect()
      }
    }

    this.ws.onerror = (event) => {
      this.options.onError(event)
    }
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data)
    }
  }

  sendJSON(data: unknown): void {
    this.send(JSON.stringify(data))
  }

  close(): void {
    this.manualClose = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private tryReconnect(): void {
    if (this.reconnectCount >= this.options.maxReconnectAttempts) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectCount++
      this.connect()
    }, this.options.reconnectInterval)
  }
}
