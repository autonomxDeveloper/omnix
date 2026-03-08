/**
 * LM Studio Chatbot - FastAPI WebSocket Client
 * Ultra-low-latency voice conversation using WebSocket + AudioWorklet
 * Replaces HTTP streaming with binary WebSocket for sub-500ms latency
 */

console.log('[WS-CLIENT] Starting to load...');

// ============== CONFIG ==============
const WS_URL = `ws://${window.location.host}/ws/conversation`;
const SAMPLE_RATE = 24000; // Server sends 24kHz
const START_BUFFER_SAMPLES = 6000;
let FRAME_SIZE = 3840; // Will be updated based on native rate

let pendingBuffer = new Float32Array(0);
let nativeSampleRate = 48000; // Will be updated from AudioContext

function appendSamples(newSamples) {
    const merged = new Float32Array(pendingBuffer.length + newSamples.length);
    merged.set(pendingBuffer, 0);
    merged.set(newSamples, pendingBuffer.length);
    pendingBuffer = merged;
}

// ============== STATE ==============
let ws = null;
let wsAudioContext = null;
let pcmNode = null;
let wsGainNode = null;
let isConnected = false;
let isSpeaking = false;
let wsSessionId = null;
let currentSpeaker = 'default';

let startupBuffer = [];
let bufferedSamples = 0;
let playbackStarted = false;

// Timing
let totalStartTime = 0;
let llmFirstTokenTime = 0;
let firstAudioTime = 0;
let currentAssistantDiv = null;
let streamedContent = '';
let responseComplete = false;

function addWSSystemMessage(role, content) {
    const convChatView = document.getElementById('conversationChatView');
    const isConversationMode = convChatView && convChatView.classList.contains('active');
    
    if (isConversationMode) {
        const convMessages = document.getElementById('conversationMessages');
        if (convMessages) {
            const msgDiv = document.createElement('div');
            msgDiv.className = `conversation-message ${role}`;
            
            const avDiv = document.createElement('div');
            avDiv.className = 'conversation-message-avatar';
            avDiv.textContent = role === 'user' ? '👤' : '🤖';
            
            const contDiv = document.createElement('div');
            contDiv.className = 'conversation-message-content';
            contDiv.textContent = content;
            
            msgDiv.appendChild(avDiv);
            msgDiv.appendChild(contDiv);
            convMessages.appendChild(msgDiv);
            convMessages.scrollTop = convMessages.scrollHeight;
            return msgDiv;
        }
    }
    
    if (typeof addMessage === 'function') {
        return addMessage(role === 'user' ? 'user' : 'assistant', content);
    }
    return null;
}


// ============== AUDIOWORKLET SETUP ==============
/**
 * Initialize AudioWorklet for low-latency playback with queue
 */
async function initAudioWorklet() {
    if (wsAudioContext) return;
    
    console.log('[WS-AUDIO] Initializing AudioWorklet...');
    
    try {
        // Use native sample rate - don't force it
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const actualRate = audioContext.sampleRate;
        window.nativeSampleRate = actualRate;
        nativeSampleRate = actualRate;
        FRAME_SIZE = Math.round(3840 * (actualRate / 48000)); // Scale frame size
        console.log("[WS-AUDIO] Native sample rate:", actualRate + "Hz, FRAME_SIZE:", FRAME_SIZE);
        
        await audioContext.audioWorklet.addModule("/static/js/audio/pcm-player-worklet.js?v=" + Date.now());
        
        pcmNode = new AudioWorkletNode(audioContext, "pcm-player");
        pcmNode.connect(audioContext.destination);
        console.log("[WS-AUDIO] Initialized AudioContext:", audioContext.sampleRate + "Hz");
        
        if (audioContext.state === "suspended") {
            await audioContext.resume();
            console.log("[WS-AUDIO] AudioContext resumed");
        }
        
        wsAudioContext = audioContext;
        
        wsGainNode = wsAudioContext.createGain();
        wsGainNode.gain.value = 1.0;
        
        pcmNode.disconnect();
        pcmNode.connect(wsGainNode);
        wsGainNode.connect(wsAudioContext.destination);
        
        window.streamingAudioContext = wsAudioContext;
        
        console.log('[WS-CLIENT] AudioWorklet connected');
        console.log('[AUDIO] Using queue-based streaming playback');
        
        document.addEventListener('click', async () => {
            if (wsAudioContext && wsAudioContext.state === 'suspended') {
                await wsAudioContext.resume();
                console.log('[WS-AUDIO] AudioContext resumed on click');
            }
        }, { once: true });
        
        testSpeaker();
    } catch (e) {
        console.error('[WS-AUDIO] Failed to initialize AudioWorklet:', e);
    }
}


/**
 * Test speaker output - play a test tone to verify audio pipeline
 */
function testSpeaker() {
    try {
        const osc = wsAudioContext.createOscillator();
        const gain = wsAudioContext.createGain();
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(wsAudioContext.destination);
        osc.frequency.value = 880;
        osc.start();
        setTimeout(() => {
            osc.stop();
            console.log('[WS-AUDIO] Speaker test completed');
        }, 200);
        console.log('[WS-AUDIO] Speaker test started');
    } catch (e) {
        console.error('[WS-AUDIO] Speaker test failed:', e);
    }
}


/**
 * Push raw PCM samples to AudioWorklet queue
 * @param {ArrayBuffer|Float32Array} samples - Audio data
 * @param {string} format - Optional: 'int16' or 'float32' (default: 'int16' for backward compat)
 */
function pushAudioData(samples, format = 'int16') {
    if (!pcmNode || !wsAudioContext) {
        console.warn('[WS-CLIENT] AudioWorklet not ready');
        return;
    }
    
    if (wsAudioContext.state === 'suspended') {
        wsAudioContext.resume();
    }
    
    // Handle both ArrayBuffer and Float32Array inputs
    if (samples instanceof ArrayBuffer) {
        if (format === 'int16') {
            // Convert Int16 -> Float32 (WAV path)
            const int16View = new Int16Array(samples);
            samples = new Float32Array(int16View.length);
            for (let i = 0; i < int16View.length; i++) {
                samples[i] = int16View[i] / 32768;
            }
        } else {
            // Already Float32 (binary PCM path)
            samples = new Float32Array(samples);
        }
    }
    
    // upsample 24k → native rate (e.g., 48kHz)
    const upsampleFactor = (window.nativeSampleRate || 48000) / 24000;
    if (samples instanceof Float32Array && upsampleFactor > 1) {
        const pcm24 = samples;
        const pcm48 = new Float32Array(Math.ceil(pcm24.length * upsampleFactor));
        for (let i = 0; i < pcm24.length; i++) {
            for (let j = 0; j < upsampleFactor; j++) {
                pcm48[i * upsampleFactor + j] = pcm24[i];
            }
        }
        samples = pcm48;
    }
    
    if (!samples || !(samples.length > 0)) {
        return;
    }
    
    if (!playbackStarted) {
        startupBuffer.push(samples);
        bufferedSamples += samples.length;
        
        if (bufferedSamples >= START_BUFFER_SAMPLES) {
            let merged = mergeFloat32Arrays(startupBuffer);
            
            // upsample 24k → native rate
            const upsampleFactor = (window.nativeSampleRate || 48000) / 24000;
            if (upsampleFactor > 1 && merged.length > 0) {
                const pcm24 = merged;
                const pcm48 = new Float32Array(Math.ceil(pcm24.length * upsampleFactor));
                for (let i = 0; i < pcm24.length; i++) {
                    for (let j = 0; j < upsampleFactor; j++) {
                        pcm48[i * upsampleFactor + j] = pcm24[i];
                    }
                }
                merged = pcm48;
            }
            
            const numChunks = Math.floor(merged.length / FRAME_SIZE) * FRAME_SIZE;
            const toSend = merged.subarray(0, numChunks);
            const remainder = merged.subarray(numChunks);
            
            // Append to pending buffer
            appendSamples(toSend);
            
            // Flush accumulated frames
            while (pendingBuffer.length >= FRAME_SIZE) {
                const frame = pendingBuffer.slice(0, FRAME_SIZE);
                pcmNode.port.postMessage(frame);
                pendingBuffer = pendingBuffer.slice(FRAME_SIZE);
            }
            
            if (remainder.length > 0) {
                startupBuffer = [remainder];
                bufferedSamples = remainder.length;
            } else {
                playbackStarted = true;
                startupBuffer = [];
                bufferedSamples = 0;
            }
        }
        return;
    }
    
    // Accumulate samples before sending to worklet for stable timing
    if (samples instanceof Float32Array) {
        appendSamples(samples);
    }
    
    // Send in fixed-size frames
    while (pendingBuffer.length >= FRAME_SIZE) {
        const frame = pendingBuffer.slice(0, FRAME_SIZE);
        pcmNode.port.postMessage(frame);
        pendingBuffer = pendingBuffer.slice(FRAME_SIZE);
    }
}


function mergeFloat32Arrays(arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}


/**
 * Stop audio playback
 */
function stopAudio() {
    // Flush any pending samples before stopping
    if (pcmNode && pcmNode.port && pendingBuffer.length > 0) {
        pcmNode.port.postMessage(pendingBuffer);
        pendingBuffer = new Float32Array(0);
    }
    
    if (pcmNode && pcmNode.port) {
        pcmNode.port.postMessage({ type: 'stop' });
    }
    isSpeaking = false;
    pendingBuffer = new Float32Array(0);
    
    if (typeof updateConversationStatus === 'function') {
        updateConversationStatus('Ready to chat');
    }
    if (typeof showCircleIndicator === 'function') {
        showCircleIndicator('idle');
    }
}


// ============== WEBSOCKET CONNECTION ==============
/**
 * Connect to FastAPI WebSocket
 */
async function connectWebSocket(sessionIdVal, speakerVal) {
    wsSessionId = sessionIdVal;
    currentSpeaker = speakerVal;
    
    // If already connected, just send config and return
    if (ws && isConnected) {
        console.log('[WS-CLIENT] Already connected, reusing connection');
        ws.send(JSON.stringify({
            type: 'config',
            session_id: wsSessionId,
            speaker: currentSpeaker
        }));
        return Promise.resolve();
    }
    
    // Reset audio pipeline before new connection
    if (pcmNode && pcmNode.port) {
        pcmNode.port.postMessage({ type: 'reset' });
    }
    playbackStarted = false;
    startupBuffer = [];
    bufferedSamples = 0;
    pendingBuffer = new Float32Array(0);
    
    return new Promise((resolve, reject) => {
        ws = new WebSocket(WS_URL);
        ws.binaryType = 'arraybuffer';
        
        ws.onopen = async () => {
            console.log('[WS-CLIENT] Connected');
            isConnected = true;
            
            // Initialize audio - this now handles resume internally
            await initAudioWorklet();
            
            // Send config
            ws.send(JSON.stringify({
                type: 'config',
                session_id: wsSessionId,
                speaker: currentSpeaker
            }));
            
            resolve();
        };
        
        ws.onmessage = (event) => {
            console.log("[WS] Received message, type:", event.data.constructor.name, "size:", event.data instanceof ArrayBuffer ? event.data.byteLength : "N/A");
            
            if (event.data instanceof ArrayBuffer) {
                handleAudioData(event.data);
                return;
            }
            
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('[WS-CLIENT] Parse error:', e);
            }
        };
        
        ws.onerror = (error) => {
            console.error('[WS-CLIENT] Error:', error);
            reject(error);
        };
        
        ws.onclose = () => {
            console.log('[WS-CLIENT] Disconnected');
            isConnected = false;
            isSpeaking = false;
        };
    });
}


/**
 * Handle incoming messages
 */
async function handleMessage(msg) {
    const type = msg.type;
    
    switch (type) {
        case 'ready':
            console.log('[WS-CLIENT] Ready for conversation');
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Ready to chat');
            }
            break;
            
        case 'token':
            // LLM generated first token
            if (llmFirstTokenTime === 0) {
                llmFirstTokenTime = msg.time;
                console.log(`🕐 [WS] LLM first token: ${msg.time}ms`);
            }
            break;
            
        case 'content':
            streamedContent += msg.content;
            if (currentAssistantDiv) {
                const contentEl = currentAssistantDiv.querySelector('.conversation-message-content, .message-content, .message-text');
                if (contentEl) {
                    contentEl.textContent = streamedContent;
                } else {
                    currentAssistantDiv.textContent = streamedContent;
                }
            } else {
                currentAssistantDiv = addWSSystemMessage('assistant', streamedContent);
            }
            break;
            
        case 'audio':
            // Extract audio data from message (base64 encoded WAV)
            const audioBase64 = msg.data;
            if (!audioBase64) {
                console.warn('[WS-CLIENT] No audio data in message');
                break;
            }
            
            // Decode base64 to ArrayBuffer
            const audioBytes = atob(audioBase64);
            const wavBuffer = new ArrayBuffer(audioBytes.length);
            const wavUint8Array = new Uint8Array(wavBuffer);
            for (let i = 0; i < audioBytes.length; i++) {
                wavUint8Array[i] = audioBytes.charCodeAt(i);
            }
            
            // Decode WAV to PCM using AudioContext
            if (typeof window.wsWavAudioContext === 'undefined') {
                window.wsWavAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            try {
                const audioBuffer = await window.wsWavAudioContext.decodeAudioData(wavBuffer.slice(0));
                const channelData = audioBuffer.getChannelData(0);
                
                // Convert Float32 to Int16 for the AudioWorklet
                const int16Array = new Int16Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                    int16Array[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
                }
                
                // Track first audio time
                if (firstAudioTime === 0) {
                    firstAudioTime = performance.now() - totalStartTime;
                    console.log(`🕐 [WS] First audio: ${firstAudioTime.toFixed(0)}ms`);
                    
                    // Update metrics when first audio arrives
                    const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
                    const tokenSpeed = (llmFirstTokenTime > 0 && tokensGenerated > 0) 
                        ? (tokensGenerated / (firstAudioTime / 1000)) 
                        : 0;
                    
                    console.log('[METRICS] Calling updateTimingSummary, firstAudioTime:', firstAudioTime);
                    
                    if (typeof window.updateTimingSummary === 'function') {
                        window.updateTimingSummary({
                            requestStart: totalStartTime,
                            total: firstAudioTime,
                            llm: llmFirstTokenTime > 0 ? llmFirstTokenTime : 0,
                            llmDone: firstAudioTime,
                            tts: firstAudioTime,
                            audioPlayStart: firstAudioTime,
                            tokens: tokensGenerated,
                            tokensPerSecond: tokenSpeed
                        });
                        console.log('[METRICS] updateTimingSummary called successfully');
                    } else {
                        console.log('[METRICS] window.updateTimingSummary is NOT a function');
                    }
                }
                
                // Only set "Speaking..." if response is not complete yet
                if (!responseComplete && !isSpeaking) {
                    isSpeaking = true;
                    if (typeof updateConversationStatus === 'function') {
                        updateConversationStatus('🔊 Speaking...', 'speaking');
                    }
                    if (typeof showCircleIndicator === 'function') {
                        showCircleIndicator('speaking');
                    }
                }
                
                // Push decoded PCM to AudioWorklet (converts Int16 -> Float32 internally)
                pushAudioData(int16Array.buffer);
            } catch (e) {
                console.error('[WS-CLIENT] Failed to decode audio:', e);
            }
            break;
            
        case 'done':
            // LLM finished
            const totalTime = msg.total_time;
            console.log(`⏱️ [WS] Total response time: ${totalTime.toFixed(0)}ms`);
            console.log('[WS] Setting status to Ready to chat');
            
            responseComplete = true;
            
            // Update metrics when done (use total time)
            const tokensGeneratedDone = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
            const tokenSpeedDone = (llmFirstTokenTime > 0 && tokensGeneratedDone > 0) 
                ? (tokensGeneratedDone / (totalTime / 1000)) 
                : 0;
            
            console.log('[METRICS] Calling updateTimingSummary from done, total:', totalTime);
            
            if (typeof window.updateTimingSummary === 'function') {
                window.updateTimingSummary({
                    requestStart: totalStartTime,
                    total: totalTime,
                    llm: llmFirstTokenTime > 0 ? llmFirstTokenTime : 0,
                    llmDone: totalTime,
                    tts: firstAudioTime > 0 ? firstAudioTime : totalTime,
                    audioPlayStart: firstAudioTime > 0 ? firstAudioTime : totalTime,
                    tokens: tokensGeneratedDone,
                    tokensPerSecond: tokenSpeedDone
                });
                console.log('[METRICS] updateTimingSummary called from done');
            } else {
                console.log('[METRICS] window.updateTimingSummary is NOT a function in done');
            }
            const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
            const tokenSpeed = (llmFirstTokenTime > 0 && tokensGenerated > 0) 
                ? (tokensGenerated / (totalTime / 1000)) 
                : 0;
            
            if (typeof window.updateTimingSummary === 'function') {
                window.updateTimingSummary({
                    requestStart: totalStartTime,
                    total: totalTime,
                    llm: llmFirstTokenTime > 0 ? llmFirstTokenTime : 0,
                    llmDone: totalTime,
                    tts: firstAudioTime > 0 ? firstAudioTime : 0,
                    audioPlayStart: firstAudioTime > 0 ? firstAudioTime : 0,
                    tokens: tokensGenerated,
                    tokensPerSecond: tokenSpeed
                });
            }
            
            // Update status after response is done - call BOTH stopAudio and explicit update
            stopAudio();
            
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Ready to chat');
                console.log('[WS] updateConversationStatus called with Ready to chat');
            }
            
            currentAssistantDiv = null;
            streamedContent = '';
            break;
            
        case 'stopped':
            stopAudio();
            currentAssistantDiv = null;
            streamedContent = '';
            break;
            
        case 'error':
            console.error('[WS-CLIENT] Server error:', msg.error);
            stopAudio();
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Error: ' + msg.error);
            }
            break;
    }
}


/**
 * Handle incoming binary PCM audio data (Float32)
 */
function handleAudioData(pcmBytes) {
    let samples = new Float32Array(pcmBytes);
    
    // Server always sends 4800 samples (200ms at 24kHz)
    const expectedSamples = 4800;
    if (samples.length !== expectedSamples) {
        const fixed = new Float32Array(expectedSamples);
        if (samples.length > expectedSamples) {
            fixed.set(samples.subarray(0, expectedSamples));
        } else {
            fixed.set(samples);
        }
        samples = fixed;
    }
    
    if (window.DEBUG_AUDIO) {
        console.log("PCM length:", samples.length);
    }
    
    if (firstAudioTime === 0) {
        firstAudioTime = performance.now() - totalStartTime;
        console.log(`🕐 [WS] First audio: ${firstAudioTime.toFixed(0)}ms`);
    }
    
    if (!isSpeaking) {
        isSpeaking = true;
        if (typeof updateConversationStatus === 'function') {
            updateConversationStatus('🔊 Speaking...', 'speaking');
        }
        if (typeof showCircleIndicator === 'function') {
            showCircleIndicator('speaking');
        }
    }
    
    pushAudioData(samples, 'float32');
}


// ============== API FUNCTIONS ==============
/**
 * Start a new conversation via WebSocket
 */
window.wsConversationStart = async function(sessionIdVal, speakerVal) {
    try {
        totalStartTime = performance.now();
        llmFirstTokenTime = 0;
        firstAudioTime = 0;
        
        playbackStarted = false;
        startupBuffer = [];
        bufferedSamples = 0;
        
        await connectWebSocket(sessionIdVal, speakerVal);
        
        return { success: true };
    } catch (e) {
        console.error('[WS-CLIENT] Connection failed:', e);
        return { success: false, error: e.message };
    }
};


/**
 * Send text to conversation
 */
window.wsConversationSend = function(text) {
    if (!ws || !isConnected) {
        console.error('[WS-CLIENT] Not connected');
        return false;
    }
    
    try {
        addWSSystemMessage('user', text);
        
        streamedContent = '';
        currentAssistantDiv = null;
        responseComplete = false;
        
        ws.send(JSON.stringify({
            type: 'text',
            text: text
        }));
        return true;
    } catch (e) {
        console.error('[WS-CLIENT] Send failed:', e);
        return false;
    }
};


/**
 * Stop conversation
 */
window.wsConversationStop = function() {
    if (!ws || !isConnected) {
        return;
    }
    
    try {
        ws.send(JSON.stringify({ type: 'stop' }));
        stopAudio();
    } catch (e) {
        console.error('[WS-CLIENT] Stop failed:', e);
    }
};


/**
 * Disconnect WebSocket
 */
window.wsConversationDisconnect = function() {
    if (ws) {
        ws.close();
        ws = null;
    }
    isConnected = false;
    isSpeaking = false;
    stopAudio();
};


console.log('[WS-CLIENT] Loaded and ready');
