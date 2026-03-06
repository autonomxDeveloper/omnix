/**
 * LM Studio Chatbot - TTS Queue
 * Manages TTS audio queuing and sequential playback
 */

// Global audio playback control for WAV mode (REST API)
let globalAudioPlayQueue = [];
let globalAudioPlaying = false;

// Streaming TTS WebSocket connection
let ttsWebSocket = null;

// ============================================================
// GLOBAL AUDIO QUEUE (WAV Mode - REST API)
// ============================================================

/**
 * Enqueue audio chunk for sequential playback
 * @param {string} audioBase64 - Base64 encoded complete WAV file
 * @param {number} sampleRate - Sample rate of the audio
 */
function enqueueAudio(audioBase64, sampleRate) {
    // Don't queue more audio if stop requested
    if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
        return;
    }
    
    globalAudioPlayQueue.push({ audioBase64, sampleRate });
    
    if (conversationMode) {
        updateConversationStatus('🔊 Speaking...', 'speaking');
        showCircleIndicator('speaking');
    }
    
    // Always try to start playback
    playNextAudio();
}

/**
 * Play next audio chunk in the global queue
 */
async function playNextAudio() {
    // Check if stop was requested
    if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
        globalAudioPlaying = false;
        globalAudioPlayQueue = [];
        return;
    }
    
    // If already playing or nothing in queue, just return
    if (globalAudioPlaying || globalAudioPlayQueue.length === 0) return;
    
    globalAudioPlaying = true;
    const audioPlayStartTime = performance.now();
    
    const { audioBase64, sampleRate } = globalAudioPlayQueue.shift();
    try {
        // Use the AudioPlayer module's playTTS function
        if (typeof window.AudioPlayer !== 'undefined' && window.AudioPlayer.playTTS) {
            await window.AudioPlayer.playTTS(audioBase64, sampleRate);
        } else {
            console.error('[TTS-QUEUE] AudioPlayer.playTTS not available');
        }
    } catch (e) {
        console.error('[TTS-QUEUE] Audio playback error:', e);
    }
    
    // Check stop flag again after playback
    if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
        globalAudioPlaying = false;
        globalAudioPlayQueue = [];
        return;
    }
    
    globalAudioPlaying = false;
    
    // Immediately check for more in queue
    if (globalAudioPlayQueue.length > 0 && !stopAudioRequested) {
        setTimeout(() => playNextAudio(), 0);
    }
}

// ============================================================
// WEBSOCKET TTS (Streaming Mode)
// ============================================================

/**
 * Connect to streaming TTS WebSocket
 */
function connectTTSWebSocket() {
    return new Promise((resolve, reject) => {
        if (ttsWebSocket && ttsWebSocket.readyState === WebSocket.OPEN) {
            resolve(ttsWebSocket);
            return;
        }
        
        const wsUrl = `ws://localhost:8020/ws/tts`;
        ttsWebSocket = new WebSocket(wsUrl);
        
        ttsWebSocket.onopen = () => {
            console.log('[TTS-WS] Connected');
            resolve(ttsWebSocket);
        };
        
        ttsWebSocket.onerror = (error) => {
            console.error('[TTS-WS] Error:', error);
            reject(error);
        };
        
        ttsWebSocket.onclose = () => {
            console.log('[TTS-WS] Closed');
            ttsWebSocket = null;
        };
        
        // Simple JSON message handling - like pocket-tts-server
        ttsWebSocket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                console.log('[TTS-WS] Message:', msg.type, msg.chunk);
                
                if (msg.type === 'audio') {
                    // Queue the complete WAV file
                    window.AudioPlayer?.queueTTSChunk?.(msg.data);
                } else if (msg.type === 'done') {
                    console.log('[TTS-WS] Stream complete');
                } else if (msg.type === 'error') {
                    console.error('[TTS-WS] Server error:', msg.data);
                }
            } catch (e) {
                console.error('[TTS-WS] Parse error:', e);
            }
        };
    });
}

/**
 * Stream TTS via WebSocket - simple approach matching pocket-tts-server
 */
async function speakTextViaWebSocket(text, voiceCloneId = null) {
    console.log('[TTS-WS] speakTextViaWebSocket:', text.substring(0, 50));
    
    // Clear simple queue
    if (typeof window.AudioPlayer?.clearTTSQueue === 'function') {
        window.AudioPlayer.clearTTSQueue();
    }
    
    // Reset stop flag
    if (typeof stopAudioRequested !== 'undefined') {
        stopAudioRequested = false;
    }
    
    try {
        await connectTTSWebSocket();
        
        const request = {
            text: text,
            voice_clone_id: voiceCloneId
        };
        ttsWebSocket.send(JSON.stringify(request));
        console.log('[TTS-WS] Request sent');
        
        // Wait for all playback (simple queue handles this automatically)
        return new Promise((resolve) => {
            const checkDone = () => {
                if (!window.AudioPlayer?.ttsIsPlayingQueue && 
                    window.AudioPlayer?.ttsAudioQueue?.length === 0) {
                    resolve();
                } else {
                    setTimeout(checkDone, 100);
                }
            };
            checkDone();
        });
        
    } catch (error) {
        console.error('[TTS-WS] Error:', error);
        // Fall back to batch TTS
        if (typeof speakText === 'function') {
            await speakText(text, voiceCloneId);
        }
    }
}

/**
 * Clear the audio queue and stop playback
 */
function clearAudioQueue() {
    globalAudioPlayQueue = [];
    globalAudioPlaying = false;
    if (typeof window.AudioPlayer?.clearTTSQueue === 'function') {
        window.AudioPlayer.clearTTSQueue();
    }
}

// Export for use in other modules
window.TTSQueue = {
    enqueueAudio,
    playNextAudio,
    clearAudioQueue,
    connectTTSWebSocket,
    speakTextViaWebSocket
};