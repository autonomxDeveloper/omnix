export class STTClient {
  constructor(onTranscript, onFinal) {
    this.onTranscript = onTranscript;
    this.onFinal = onFinal;
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.url = 'ws://localhost:8000/ws/transcribe';
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

        this.ws.onopen = () => {
          console.log('[STTClient] Connected');
          this.connected = true;
          this.connecting = false;
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
              case 'ready':
                console.log('[STTClient] Server ready');
                break;
                
              case 'text':
                if (this.onTranscript) {
                  this.onTranscript(data.text);
                }
                break;
                
              case 'done':
                if (this.onFinal) {
                  this.onFinal(data.text);
                }
                break;
                
              case 'error':
                console.error('[STTClient] Server error:', data.error);
                break;
            }
          } catch (e) {
            console.error('[STTClient] Parse error:', e);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[STTClient] WebSocket error:', error);
          this.connected = false;
          this.connecting = false;
        };

        this.ws.onclose = () => {
          console.log('[STTClient] Disconnected');
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

  sendAudio(chunk) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const float32 = chunk;
      const int16 = new Int16Array(float32.length);
      
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-1, Math.min(1, float32[i])) * 32767;
      }

      const uint8 = new Uint8Array(int16.buffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      this.ws.send(JSON.stringify({
        type: 'audio',
        data: base64
      }));
    } catch (e) {
      console.error('[STTClient] Error sending audio:', e);
    }
  }

  sendFinal() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'final' }));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }
}

export default STTClient;
