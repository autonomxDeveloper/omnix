export class AudioInput {
  constructor(onSpeechStart, onSpeechEnd, onAudioChunk) {
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.onAudioChunk = onAudioChunk;
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.analyser = null;
    this.source = null;
    this.isRecording = false;
    this.silenceTimeout = null;
    this.isSpeaking = false;
    this.speechStartTime = 0;
    this.accumulatedAudio = [];
    
    this.VAD_SILENCE_THRESHOLD = 0.008;
    this.VAD_SILENCE_TIMEOUT = 400;
    this.MIN_SPEECH_DURATION = 0.3;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: 'interactive'
      });

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.source.connect(this.analyser);

      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = this.handleAudioProcess.bind(this);
      
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.isRecording = true;
      this.startVADLoop();
      
      console.log('[AudioInput] Started successfully');
    } catch (error) {
      console.error('[AudioInput] Failed to start:', error);
      throw error;
    }
  }

  handleAudioProcess(event) {
    if (!this.isRecording) return;
    
    const inputData = event.inputBuffer.getChannelData(0);
    const chunk = new Float32Array(inputData);
    
    this.accumulatedAudio.push(chunk);
    
    if (this.onAudioChunk) {
      this.onAudioChunk(chunk);
    }
  }

  startVADLoop() {
    const checkVAD = () => {
      if (!this.isRecording || !this.analyser) {
        if (this.isRecording) {
          requestAnimationFrame(checkVAD);
        }
        return;
      }

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length / 255;

      if (average > this.VAD_SILENCE_THRESHOLD) {
        if (!this.isSpeaking) {
          this.isSpeaking = true;
          this.speechStartTime = performance.now();
          
          if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
          }
          
          if (this.onSpeechStart) {
            this.onSpeechStart();
          }
        }
      } else if (this.isSpeaking) {
        if (!this.silenceTimeout) {
          this.silenceTimeout = setTimeout(() => {
            const duration = (performance.now() - this.speechStartTime) / 1000;
            if (duration >= this.MIN_SPEECH_DURATION) {
              this.handleSpeechEnd();
            } else {
              this.isSpeaking = false;
            }
          }, this.VAD_SILENCE_TIMEOUT);
        }
      }

      if (this.isRecording) {
        requestAnimationFrame(checkVAD);
      }
    };

    requestAnimationFrame(checkVAD);
  }

  handleSpeechEnd() {
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
    
    this.isSpeaking = false;
    
    if (this.onSpeechEnd) {
      this.onSpeechEnd();
    }
  }

  stop() {
    this.isRecording = false;
    
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.analyser = null;
    this.accumulatedAudio = [];
    
    console.log('[AudioInput] Stopped');
  }

  getAccumulatedAudio() {
    if (this.accumulatedAudio.length === 0) return null;
    
    const totalLength = this.accumulatedAudio.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.accumulatedAudio) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    this.accumulatedAudio = [];
    return combined;
  }
}

export default AudioInput;
