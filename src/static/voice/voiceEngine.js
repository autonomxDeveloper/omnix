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
    this.onUserMessage = options.onUserMessage || (() => {});
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
    // TTS queue: process segments sequentially so audio never overlaps or repeats
    this.ttsQueue = [];
    this.ttsProcessing = false;
    // Guard against stale audio chunks arriving after an interrupt
    this.ignoreAudioChunks = false;
    this.minTranscriptLength = 2;
    // TTS buffer flush thresholds
    this.TTS_FLUSH_LENGTH = 80;
    this.TTS_MAX_BUFFER_LENGTH = 300;
    // When false, VAD is paused after each turn so the user must type
    this.alwaysListening = options.alwaysListening !== false;
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
    this.ttsQueue = [];
    this.ttsProcessing = false;
    this.ignoreAudioChunks = false;
    this.responseFinished = false;
  }

  onSpeechStart() {
    const isInterrupt = (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) 
                        && this.audioInput.hasEnoughAudioForInterrupt();
    
    this.ttsBuffer = '';
    this.responseFinished = false;
    this.hasStartedSpeaking = false;
    
    if (isInterrupt) {
      console.log('[VoiceEngine] User interrupted AI');
      
      this.ttsQueue = [];
      this.ttsProcessing = false;
      this.ignoreAudioChunks = true;
      this.audioOutput.stop();
      this.llm.cancel();
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

    this.onUserMessage(text);
    this.llm.sendMessage(text, this.sessionId, this.speaker);
  }

  /**
   * Send a typed (text) message directly to the LLM, bypassing STT.
   * Interrupts any ongoing AI speech, displays the user message, and starts
   * the LLM/TTS pipeline just like a voice transcript would.
   */
  sendTypedMessage(text) {
    if (!text || !text.trim()) return;

    console.log('[VoiceEngine] Typed message:', text.trim());

    // Interrupt any ongoing AI speech/generation
    if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      this._cancelOngoingResponse();
    }

    this.onUserMessage(text.trim());
    this.setState(VoiceState.THINKING);
    this.audioInput.pauseVAD();
    this.ignoreAudioChunks = false;
    this.llm.sendMessage(text.trim(), this.sessionId, this.speaker);
  }

  onLLMStart() {
    this.accumulatedResponse = '';
    // Allow audio chunks from this new response; clear any stale-chunk guard
    this.ignoreAudioChunks = false;
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
    
    if (this.ttsBuffer.length > this.TTS_MAX_BUFFER_LENGTH) {
      // Hard cap: flush to prevent unbounded buffer growth
      const flushText = this.ttsBuffer;
      this.ttsBuffer = '';
      this.addToTTSQueue(flushText);
      return;
    }
    
    if (this.ttsBuffer.length > this.TTS_FLUSH_LENGTH && !this.ttsProcessing && this.ttsQueue.length === 0) {
      // Flush when enough text has accumulated and nothing is queued/processing
      const flushText = this.ttsBuffer;
      this.ttsBuffer = '';
      this.addToTTSQueue(flushText);
      return;
    }
    
    const sentenceMatch = this.ttsBuffer.match(/(.+?[.!?])(\s|$)/);
    
    if (sentenceMatch) {
      const sentence = sentenceMatch[1];
      this.ttsBuffer = this.ttsBuffer.slice(sentence.length);
      this.addToTTSQueue(sentence);
    }
  }

  /** Add text to the TTS processing queue and kick off processing if idle. */
  addToTTSQueue(text) {
    if (!text || !text.trim()) return;
    this.ttsQueue.push(text);
    this.processTTSQueue();
  }

  /** Process the next item in the TTS queue (one at a time to avoid overlapping audio). */
  async processTTSQueue() {
    if (this.ttsProcessing) return;  // Already generating; onTTSDone will call us again
    if (this.ttsQueue.length === 0) return;

    const text = this.ttsQueue.shift();
    this.ttsProcessing = true;

    if (this.ttsConnected && this.tts.ws && this.tts.ws.readyState === WebSocket.OPEN) {
      this.tts.sendText(text, this.speaker);
      // ttsProcessing cleared in onTTSDone when server responds
    } else {
      await this._sendTTSHTTP(text);
    }
  }

  async _sendTTSHTTP(text) {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, speaker: this.speaker })
      });
      
      const data = await response.json();
      
      if (data.success && data.audio) {
        const audioData = this.base64ToArrayBuffer(data.audio);
        if (!this.ignoreAudioChunks) {
          this.audioOutput.enqueue(audioData);
        }
      }
    } catch (e) {
      console.error('[VoiceEngine] HTTP TTS failed:', e);
    } finally {
      this.ttsProcessing = false;
      this.processTTSQueue();       // Process next in queue
      this._tryCompleteResponse();  // Check if turn is fully done
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
      this.addToTTSQueue(this.ttsBuffer);
      this.ttsBuffer = '';
    }
    this.responseFinished = true;
    // Check immediately: if TTS/audio already finished before this callback arrived
    this._tryCompleteResponse();
  }

  onTTSStart() {
  }

  onAudioChunk(chunk) {
    // Ignore stale chunks that arrive after an interrupt or stop
    if (this.ignoreAudioChunks) return;
    this.audioOutput.enqueue(chunk);
  }

  onTTSDone() {
    this.ttsProcessing = false;
    this.processTTSQueue();       // Kick off next segment if any
    this._tryCompleteResponse();  // Finish turn if everything is done
  }

  onPlaybackEnded() {
    this._tryCompleteResponse();
  }

  /**
   * Cancel any ongoing LLM/TTS pipeline and reset generation state, without
   * changing the VoiceState or touching the microphone.  Shared by
   * sendTypedMessage(), interrupt(), and interruptAI().
   */
  _cancelOngoingResponse() {
    this.llm.cancel();
    this.tts.cancel();
    this.audioOutput.stop();
    this.ttsQueue = [];
    this.ttsProcessing = false;
    this.ignoreAudioChunks = true;
    this.accumulatedResponse = '';
    this.ttsBuffer = '';
    this.responseFinished = false;
    this.hasStartedSpeaking = false;
  }

  /**
   * Central "are we done?" check.
   * Transitions to LISTENING only when ALL of the following are true:
   *   1. LLM has finished streaming (responseFinished)
   *   2. No TTS segment is currently being generated (ttsProcessing)
   *   3. No text is waiting in the TTS queue (ttsQueue)
   *   4. The audio output queue is empty and nothing is playing (audioOutput)
   */
  _tryCompleteResponse() {
    if (!this.responseFinished) return;
    if (this.ttsProcessing || this.ttsQueue.length > 0) return;
    if (this.audioOutput.queueLength() > 0 || this.audioOutput.isPlaying()) return;

    this.responseFinished = false;
    this.hasStartedSpeaking = false;
    this.setState(VoiceState.LISTENING);
    if (this.alwaysListening) {
      this.audioInput.resumeVAD();
    }
  }

  /**
   * Toggle whether the engine automatically resumes listening after each AI turn.
   * When disabled the microphone VAD is paused and the user must type to send messages.
   */
  setAlwaysListening(enabled) {
    this.alwaysListening = enabled;
    if (this.state === VoiceState.LISTENING) {
      if (enabled) {
        this.audioInput.resumeVAD();
      } else {
        this.audioInput.pauseVAD();
      }
    }
  }

  /**
   * Fetch a greeting from the server and play it as the first AI turn.
   * Transitions through AI_SPEAKING → LISTENING (respecting alwaysListening).
   */
  async playGreeting() {
    try {
      const response = await fetch('/api/conversation/greeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker: this.speaker })
      });
      const data = await response.json();

      if (data.success) {
        if (data.text) {
          this.onAIResponse(data.text);
        }

        if (data.audio) {
          this.setState(VoiceState.AI_SPEAKING);
          this.audioInput.pauseVAD();
          this.ignoreAudioChunks = false;
          // Mark response finished so _tryCompleteResponse() can fire once playback ends
          this.responseFinished = true;
          const audioData = this.base64ToArrayBuffer(data.audio);
          this.audioOutput.enqueue(audioData);
          // onPlaybackEnded → _tryCompleteResponse → LISTENING (+ resumeVAD if alwaysListening)
        }
      }
    } catch (e) {
      console.warn('[VoiceEngine] Greeting failed:', e.message || e);
    }
  }

  interrupt() {
    if (this.state === VoiceState.AI_SPEAKING || this.state === VoiceState.THINKING) {
      console.log('[VoiceEngine] Interrupt requested');
      this._cancelOngoingResponse();
      this.setState(VoiceState.LISTENING);
      if (this.alwaysListening) {
        this.audioInput.resumeVAD();
      }
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
    this._cancelOngoingResponse();
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