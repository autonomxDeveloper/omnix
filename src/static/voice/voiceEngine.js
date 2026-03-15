import { VoiceState } from './voiceState.js?v=2';
import { AudioInput } from './audioInput.js?v=2';
import { AudioOutput } from './audioOutput.js?v=2';
import { STTClient } from './sttClient.js?v=2';
import { LLMClient } from './llmClient.js?v=2';
import { TTSClient } from './ttsClient.js?v=2';

export { VoiceState };
export class VoiceEngine {
  constructor(options = {}) {
    this.onStateChange = options.onStateChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});  // kept for external use
    this._onTranscriptCallback = options.onTranscript || (() => {});
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
      this.onAudioChunkInput.bind(this),
      this.handleUserSpeechStart.bind(this)
    );

    this.currentTranscript = '';
    this.accumulatedResponse = '';
    this.ttsBuffer = '';
    this.responseFinished = false;
    this.awaitingSTT = false;
    this.hasStartedSpeaking = false;
    this.interrupting = false;
    this.ttsActive = false;
    this.minTranscriptLength = 2;
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
    const isInterrupt = (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) 
                        && this.audioInput.hasEnoughAudioForInterrupt();
    
    this.ttsBuffer = '';
    this.responseFinished = false;
    this.hasStartedSpeaking = false;
    
    if (isInterrupt) {
      console.log('[VoiceEngine] User interrupted AI');
      
      this.audioOutput.stop();
      this.llm.cancel();
      this.ttsActive = false;
      this.audioInput.resumeVAD();
      
      this.setState(VoiceState.INTERRUPTED);
      this.accumulatedResponse = '';
      this.ttsBuffer = '';
    } else if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      return;
    }

    if (this.state !== VoiceState.INTERRUPTED) {
      this.setState(VoiceState.USER_SPEAKING);
    }
  }

  onSpeechEnd() {
    // Also handle speech-end coming in from INTERRUPTED state (user spoke after barge-in)
    if (this.state === VoiceState.INTERRUPTED) {
      this.setState(VoiceState.USER_SPEAKING);
    }
    if (this.state === VoiceState.USER_SPEAKING) {
      this.setState(VoiceState.THINKING);
      this.audioInput.pauseVAD();
      
      if (!this.awaitingSTT) {
        this.awaitingSTT = true;
        this.stt.sendFinal();

        // Safety net: if STT never responds within 4s (e.g. connection died),
        // recover the engine from THINKING back to LISTENING so it is not stuck.
        setTimeout(() => {
          if (this.awaitingSTT) {
            console.warn('[VoiceEngine] STT response timeout - recovering to LISTENING');
            this.awaitingSTT = false;
            this.setState(VoiceState.LISTENING);
            this.audioInput.resumeVAD();
          }
        }, 4000);
      }
    }
  }

  onAudioChunkInput(chunk) {
    if (this.state === VoiceState.USER_SPEAKING || this.state === VoiceState.LISTENING) {
      this.stt.sendAudio(chunk);
    }
  }

  onTranscript(text) {
    this.currentTranscript = text;
    // Call the external callback passed via options (not this method — that would recurse infinitely)
    if (this._onTranscriptCallback) this._onTranscriptCallback(text);
  }

  onSTTFinal(text) {
    this.awaitingSTT = false;
    
    if (!text || !text.trim()) {
      console.log('[VoiceEngine] Empty transcript, returning to listening');
      this.setState(VoiceState.LISTENING);
      this.audioInput.resumeVAD();
      return;
    }

    this.currentTranscript = text;
    
    if (text.trim().length < this.minTranscriptLength) {
      console.log('[VoiceEngine] Transcript too short, ignoring');
      this.setState(VoiceState.LISTENING);
      this.audioInput.resumeVAD();
      return;
    }

    console.log('[VoiceEngine] Final transcript:', text);
    
    this.llm.sendMessage(text, this.sessionId, this.speaker);
  }

  onLLMStart() {
    this.accumulatedResponse = '';
  }

  onLLMToken(token) {
    if (!this.hasStartedSpeaking) {
      this.hasStartedSpeaking = true;
      this.setState(VoiceState.AI_SPEAKING);
      this.audioInput.pauseVAD();
    }
    
    this.accumulatedResponse += token;
    this.onAIResponse(this.accumulatedResponse);
    
    this.ttsBuffer += token;
    
    if (this.ttsBuffer.length > 80 && !this.ttsActive) {
      // Flush when enough text has accumulated and we are not already generating audio
      const flushText = this.ttsBuffer;
      this.ttsBuffer = "";
      this.sendTTSChunk(flushText);
      return;
    } else if (this.ttsBuffer.length > 300) {
      // Hard cap: if ttsActive is stuck, flush anyway to avoid unbounded buffer growth
      const flushText = this.ttsBuffer;
      this.ttsBuffer = "";
      this.sendTTSChunk(flushText);
      return;
    }
    
    const sentenceMatch = this.ttsBuffer.match(/(.+?[.!?])(\s|$)/);
    
    if (sentenceMatch) {
      const sentence = sentenceMatch[1];
      this.ttsBuffer = this.ttsBuffer.slice(sentence.length);
      this.sendTTSChunk(sentence);
    }
  }

  async sendTTSChunk(text) {
    if (!text || !text.trim()) return;
    
    this.ttsActive = true;
    
    if (this.ttsConnected && this.tts.ws && this.tts.ws.readyState === WebSocket.OPEN) {
      this.tts.sendText(text, this.speaker);
    } else {
      await this.sendTTSHTTP(text);
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
      // Always clear regardless of success/failure
      this.ttsActive = false;
    } catch (e) {
      console.error('[VoiceEngine] HTTP TTS failed:', e);
      // Always clear the flag so the engine can continue even on TTS errors
      this.ttsActive = false;
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
      this.sendTTSChunk(this.ttsBuffer);
      this.ttsBuffer = '';
    }
    this.responseFinished = true;
  }

  onTTSStart() {
  }

  onAudioChunk(chunk) {
    this.audioOutput.enqueue(chunk);
  }

  onTTSDone() {
    this.ttsActive = false;
  }

  onPlaybackEnded() {
    this.ttsActive = false;

    if (!this.responseFinished) return;
    
    if (this.audioOutput.queueLength() === 0 && !this.ttsActive) {
      this.responseFinished = false;
      this.hasStartedSpeaking = false;
      this.setState(VoiceState.LISTENING);
      this.audioInput.resumeVAD();
    }
  }

  interrupt() {
    if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      console.log('[VoiceEngine] Interrupt requested');
      
      this.audioOutput.stop();
      this.tts.cancel();
      this.llm.cancel();
      this.accumulatedResponse = '';
      this.ttsBuffer = '';
      this.ttsActive = false;
      
      this.setState(VoiceState.LISTENING);
      this.audioInput.resumeVAD();
    }
  }

  handleUserSpeechStart() {
    if (this.state === VoiceState.AI_SPEAKING) {
      this.interruptAI();
    }
  }

  interruptAI() {
    if (this.interrupting) return;
    
    this.interrupting = true;
    
    this.llm.cancel();

    this.tts.cancel();
    this.audioOutput.stopAll();

    this.ttsBuffer = "";
    this.responseFinished = false;
    this.hasStartedSpeaking = false;
    this.ttsActive = false;

    this.setState(VoiceState.LISTENING);
    this.audioInput.resumeVAD();

    this.interrupting = false;
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