export class TTSClient {
  constructor(onAudioChunk, onDone, onStart) {
    this.onAudioChunk = onAudioChunk;
    this.onDone = onDone;
    this.onStart = onStart;
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.url = 'ws://localhost:8020/ws/tts';
    this.currentAudio = null;
  }

  cancel() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
      } catch (e) {}
      this.currentAudio = null;
    }
  }

  async speak(text) {
    return null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.connecting) {
        setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            resolve();
          } else {
            reject(new Error('Connection failed'));
          }
        }, 1000);
        return;
      }

      this.connecting = true;

      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[TTSClient] Connected');
          this.connected = true;
          this.connecting = false;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            if (event.data instanceof ArrayBuffer) {
              if (this.onAudioChunk) {
                this.onAudioChunk(event.data);
              }
            } else {
              const data = JSON.parse(event.data);
              
              switch (data.type) {
                case 'ready':
                  console.log('[TTSClient] Server ready');
                  break;
                  
                case 'start':
                  if (this.onStart) {
                    this.onStart();
                  }
                  break;
                  
                case 'done':
                  if (this.onDone) {
                    this.onDone();
                  }
                  break;
                  
                case 'error':
                  console.error('[TTSClient] Server error:', data.error);
                  if (this.onDone) {
                    this.onDone();
                  }
                  break;
              }
            }
          } catch (e) {
            console.error('[TTSClient] Parse error:', e);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[TTSClient] WebSocket error:', error);
          this.connected = false;
          this.connecting = false;
        };

        this.ws.onclose = () => {
          console.log('[TTSClient] Disconnected');
          this.connected = false;
          this.connecting = false;
          this.ws = null;
        };

        setTimeout(() => {
          if (!this.connected) {
            this.connecting = false;
            reject(new Error('Connection timeout'));
          }
        }, 5000);

      } catch (e) {
        this.connecting = false;
        reject(e);
      }
    });
  }

  sendText(text, voice = 'default') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[TTSClient] Not connected, cannot send text');
      return;
    }

    this.ws.send(JSON.stringify({
      text: text,
      voice: voice
    }));
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

export default TTSClient;
