export class AudioOutput {
  constructor() {
    this.audioQueue = [];
    this.playing = false;
    this.audioContext = null;
    this.currentAudio = null;
    this.onPlaybackStart = null;
    this.onPlaybackEnd = null;
    this.hasPlayedSomething = false;
  }

  async initContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive'
      });
    }
    
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  enqueue(chunk) {
    this.audioQueue.push(chunk);
    this.playNext();
  }

  async playNext() {
    if (this.playing) return;
    if (this.audioQueue.length === 0) {
      // Only fire onPlaybackEnd if we actually played something this session.
      // Avoids a spurious callback before any audio is enqueued.
      if (this.onPlaybackEnd && this.hasPlayedSomething) {
        this.hasPlayedSomething = false;
        this.onPlaybackEnd();
      }
      return;
    }

    await this.initContext();

    this.playing = true;
    this.hasPlayedSomething = true;
    
    if (this.onPlaybackStart) {
      this.onPlaybackStart();
    }

    const chunk = this.audioQueue.shift();
    
    try {
      await this.playAudioChunk(chunk);
    } catch (error) {
      console.error('[AudioOutput] Error playing chunk:', error);
    }
    
    this.playing = false;
    this.playNext();
  }

  async playAudioChunk(chunk) {
    const isFirstChunk = this.currentAudio === null;
    
    let float32;
    let sampleRate;
    
    const uint8arr = new Uint8Array(chunk);
    const arrView = new DataView(uint8arr.buffer);
    
    if (uint8arr.length > 44 && 
        String.fromCharCode(uint8arr[0], uint8arr[1], uint8arr[2], uint8arr[3]) === 'RIFF' &&
        String.fromCharCode(uint8arr[8], uint8arr[9], uint8arr[10], uint8arr[11]) === 'WAVE') {
      const wavData = this.parseWAV(uint8arr);
      float32 = wavData.float32;
      sampleRate = wavData.sampleRate;
    } else {
      let buffer = chunk;
      if (buffer.byteLength % 2 !== 0) {
        const paddedBuffer = new ArrayBuffer(buffer.byteLength + 1);
        new Uint8Array(paddedBuffer).set(new Uint8Array(buffer));
        buffer = paddedBuffer;
      }

      const pcm16 = new Int16Array(buffer);
      const numSamples = pcm16.length;
      float32 = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }
      sampleRate = 24000;
    }

    // Fade-in only on the very first chunk to avoid a click on playback start.
    // Subsequent chunks are continuous PCM — applying a fade would create
    // a volume dip at every chunk boundary.
    if (isFirstChunk) {
      const fadeLength = Math.min(48, Math.floor(float32.length / 16));
      for (let i = 0; i < fadeLength; i++) {
        float32[i] *= i / fadeLength;
      }
    }

    const audioBuffer = this.audioContext.createBuffer(1, float32.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    this.currentAudio = source;

    return new Promise((resolve, reject) => {
      source.onended = () => {
        this.currentAudio = null;
        resolve();
      };
      
      source.onerror = (error) => {
        this.currentAudio = null;
        reject(error);
      };

      source.start();
    });
  }

  parseWAV(wavData) {
    const view = new DataView(wavData.buffer);
    
    let offset = 12;
    let sampleRate = 24000;
    let numChannels = 1;
    let bitsPerSample = 16;
    
    while (offset < wavData.length - 8) {
      const id = String.fromCharCode(
        wavData[offset], wavData[offset + 1], 
        wavData[offset + 2], wavData[offset + 3]
      );
      const size = view.getUint32(offset + 4, true);
      
      if (id === 'fmt ') {
        numChannels = view.getUint16(offset + 10, true);
        sampleRate = view.getUint32(offset + 12, true);  // sampleRate is 4 bytes, not 2
        bitsPerSample = view.getUint16(offset + 22, true);
        offset += 8 + size;
      } else if (id === 'data') {
        const dataOffset = offset + 8;
        const numSamples = Math.floor(size / (bitsPerSample / 8));
        
        const float32 = new Float32Array(numSamples);
        
        if (bitsPerSample === 16) {
          for (let i = 0; i < numSamples; i++) {
            const sample = view.getInt16(dataOffset + i * 2, true);
            float32[i] = sample / 32768.0;
          }
        } else if (bitsPerSample === 32) {
          for (let i = 0; i < numSamples; i++) {
            const sample = view.getInt32(dataOffset + i * 4, true);
            float32[i] = sample / 2147483648.0;
          }
        } else if (bitsPerSample === 8) {
          for (let i = 0; i < numSamples; i++) {
            const sample = wavData[dataOffset + i] - 128;
            float32[i] = sample / 128.0;
          }
        }
        
        return { float32, sampleRate };
      } else {
        offset += 8 + size;
      }
    }
    
    return { float32: new Float32Array(0), sampleRate: 24000 };
  }

  stop() {
    this.audioQueue = [];
    this.hasPlayedSomething = false;
    
    if (this.currentAudio) {
      try {
        this.currentAudio.stop();
      } catch (e) {
      }
      this.currentAudio = null;
    }
    
    this.playing = false;
  }

  isPlaying() {
    return this.playing;
  }

  queueLength() {
    return this.audioQueue.length;
  }

  stopAll() {
    if (this.currentAudio) {
      try {
        this.currentAudio.stop();
      } catch (e) {}
      this.currentAudio = null;
    }
    
    this.audioQueue = [];
    this.playing = false;
    this.hasPlayedSomething = false;
  }

  clear() {
    this.audioQueue = [];
  }
}

export default AudioOutput;
