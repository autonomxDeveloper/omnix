import { VoiceState } from './voiceState.js';
import { AudioInput } from './audioInput.js';
import { AudioOutput } from './audioOutput.js';
import { STTClient } from './sttClient.js';
import { LLMClient } from './llmClient.js';
import { TTSClient } from './ttsClient.js';

export { VoiceState };
export class VoiceEngine {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onAIResponse = options.onAIResponse || (() => {});
    this.onError = options.onError || console.error;

    this.state = VoiceState.IDLE;
    this.speaker = options.speaker || 'default';
    this.sessionId = options.sessionId || null;

    this.audioOutput = new AudioOutput();
    
    this.stt = new STTClient(
      this.onTranscript.bind(this),
      this.onSTTFinal.bind(this)
    );
    
    this.tts = new TTSClient(
      this.onAudioChunk.bind(this),
      this.onTTSDone.bind(this),
      this.onTTSStart.bind(this)
    );
    
    this.llm = new LLMClient(
      this.onLLMToken.bind(this),
      this.onLLMEnd.bind(this),
      this.onLLMStart.bind(this)
    );

    this.audioInput = new AudioInput(
      this.onSpeechStart.bind(this),
      this.onSpeechEnd.bind(this),
      this.onAudioChunkInput.bind(this)
    );

    this.currentTranscript = '';
    this.accumulatedResponse = '';
    this.ttsBuffer = '';
    this.minTranscriptLength = 10;
  }

  setState(newState) {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange(newState);
    }
  }

  async start() {
    try {
      console.log('[VoiceEngine] Starting...');
      
      this.setState(VoiceState.LISTENING);
      this.ttsConnected = false;

      await this.stt.connect();
      
      try {
        await this.tts.connect();
        this.ttsConnected = true;
      } catch (e) {
        console.warn('[VoiceEngine] TTS WebSocket failed, will use HTTP fallback:', e.message);
        this.ttsConnected = false;
      }
      
      await this.audioInput.start();

      this.audioOutput.onPlaybackEnd = this.onPlaybackEnded.bind(this);
      
      console.log('[VoiceEngine] Started successfully, TTS WebSocket:', this.ttsConnected ? 'connected' : 'HTTP fallback');
    } catch (error) {
      console.error('[VoiceEngine] Failed to start:', error);
      this.onError(error);
      this.setState(VoiceState.IDLE);
    }
  }

  stop() {
    console.log('[VoiceEngine] Stopping...');
    
    this.audioInput.stop();
    this.stt.disconnect();
    this.tts.disconnect();
    this.audioOutput.stop();
    this.llm.cancel();

    this.setState(VoiceState.IDLE);
    
    this.currentTranscript = '';
    this.accumulatedResponse = '';
    this.ttsBuffer = '';
  }

  onSpeechStart() {
    if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      console.log('[VoiceEngine] User interrupted AI');
      
      this.audioOutput.stop();
      this.llm.cancel();
      
      this.setState(VoiceState.INTERRUPTED);
      this.accumulatedResponse = '';
      this.ttsBuffer = '';
    }

    if (this.state !== VoiceState.INTERRUPTED) {
      this.setState(VoiceState.USER_SPEAKING);
    }
  }

  onSpeechEnd() {
    if (this.state === VoiceState.USER_SPEAKING) {
      this.setState(VoiceState.THINKING);
      this.stt.sendFinal();
    }
  }

  onAudioChunkInput(chunk) {
    if (this.state === VoiceState.USER_SPEAKING || this.state === VoiceState.LISTENING) {
      this.stt.sendAudio(chunk);
    }
  }

  onTranscript(text) {
    this.currentTranscript = text;
    this.onTranscript(text);
  }

  onSTTFinal(text) {
    if (!text || !text.trim()) {
      console.log('[VoiceEngine] Empty transcript, returning to listening');
      this.setState(VoiceState.LISTENING);
      return;
    }

    this.currentTranscript = text;
    
    if (text.trim().length < this.minTranscriptLength) {
      console.log('[VoiceEngine] Transcript too short, ignoring');
      this.setState(VoiceState.LISTENING);
      return;
    }

    console.log('[VoiceEngine] Final transcript:', text);
    
    this.llm.sendMessage(text, this.sessionId, this.speaker);
  }

  onLLMStart() {
    this.accumulatedResponse = '';
  }

  onLLMToken(token) {
    this.setState(VoiceState.AI_SPEAKING);
    
    this.accumulatedResponse += token;
    this.onAIResponse(this.accumulatedResponse);
    
    this.ttsBuffer += token;
    
    if (this.ttsBuffer.length >= 20) {
      this.sendTTSChunk();
    }
  }

  sendTTSChunk() {
    if (this.ttsBuffer.trim()) {
      const text = this.ttsBuffer;
      this.ttsBuffer = '';
      
      if (this.ttsConnected && this.tts.ws && this.tts.ws.readyState === WebSocket.OPEN) {
        this.tts.sendText(text, this.speaker);
      } else {
        this.sendTTSHTTP(text);
      }
    }
  }
  
  async sendTTSHTTP(text) {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, speaker: this.speaker })
      });
      
      const data = await response.json();
      
      if (data.success && data.audio) {
        const audioData = this.base64ToArrayBuffer(data.audio);
        this.audioOutput.enqueue(audioData);
      }
    } catch (e) {
      console.error('[VoiceEngine] HTTP TTS failed:', e);
    }
  }
  
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  onLLMEnd() {
    if (this.ttsBuffer.trim()) {
      if (this.ttsConnected && this.tts.ws && this.tts.ws.readyState === WebSocket.OPEN) {
        this.tts.sendText(this.ttsBuffer, this.speaker);
      } else {
        this.sendTTSHTTP(this.ttsBuffer);
      }
      this.ttsBuffer = '';
    }
  }

  onTTSStart() {
  }

  onAudioChunk(chunk) {
    this.audioOutput.enqueue(chunk);
  }

  onTTSDone() {
  }

  onPlaybackEnded() {
    if (this.state === VoiceState.AI_SPEAKING) {
      this.setState(VoiceState.LISTENING);
    }
  }

  interrupt() {
    if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      console.log('[VoiceEngine] Interrupt requested');
      
      this.audioOutput.stop();
      this.llm.cancel();
      this.accumulatedResponse = '';
      this.ttsBuffer = '';
      
      this.setState(VoiceState.LISTENING);
    }
  }

  getState() {
    return this.state;
  }

  isSpeaking() {
    return this.state === VoiceState.AI_SPEAKING;
  }

  isListening() {
    return this.state === VoiceState.LISTENING || this.state === VoiceState.USER_SPEAKING;
  }
}

export default VoiceEngine;
