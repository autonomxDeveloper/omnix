/**
 * LM Studio Chatbot - FastAPI WebSocket Client
 * Ultra-low-latency voice conversation using WebSocket + AudioWorklet
 * Replaces HTTP streaming with binary WebSocket for sub-500ms latency
 */

console.log('[WS-CLIENT] Starting to load...');

// ============== CONFIG ==============
const WS_URL = `ws://${window.location.host}/ws/conversation`;
const SAMPLE_RATE = 24000;
let FRAME_SIZE = 1920;
const START_BUFFER_SAMPLES = 6000;

let pendingMessages = [];

let pendingBuffer = new Float32Array(0);
let nativeSampleRate = 48000;

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

let ws = null;

let totalStartTime = 0;
let llmFirstTokenTime = 0;
let firstAudioTime = 0;
let currentAssistantDiv = null;
let streamedContent = '';
let responseComplete = false;

function mergeFloat32Arrays(arrays) {
    const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Float32Array(total);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

function shouldEmitChunk(buffer) {
    if (buffer.length > 25) return true;
    if (/[.,!?;:]$/.test(buffer)) return true;
    return false;
}

async function sendTextToTTS(text) {
    if (!ws || !isConnected) return;
    
    try {
        ws.send(JSON.stringify({
            type: 'tts_request',
            text: text
        }));
    } catch (e) {
        console.error('[WS-CLIENT] TTS request failed:', e);
    }
}

function appendSamples(samples) {
    const merged = new Float32Array(pendingBuffer.length + samples.length);
    merged.set(pendingBuffer, 0);
    merged.set(samples, pendingBuffer.length);
    pendingBuffer = merged;
}

function upsample24toNative(pcm24) {
    if (nativeSampleRate === SAMPLE_RATE) return pcm24;
    const factor = nativeSampleRate / SAMPLE_RATE;
    const outLen = Math.round(pcm24.length * factor);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
        const srcPos = i / factor;
        const srcIdx = Math.floor(srcPos);
        const frac = srcPos - srcIdx;
        const s0 = pcm24[srcIdx] ?? 0;
        const s1 = pcm24[srcIdx + 1] ?? s0;
        out[i] = s0 + (s1 - s0) * frac;
    }
    return out;
}

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
async function initAudioWorklet() {
    if (wsAudioContext) return;

    wsAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    nativeSampleRate = wsAudioContext.sampleRate;
    FRAME_SIZE = Math.round(0.02 * nativeSampleRate);

    await wsAudioContext.audioWorklet.addModule("/static/js/audio/pcm-player-worklet.js?v=" + Date.now());

    pcmNode = new AudioWorkletNode(wsAudioContext, "pcm-player");
    wsGainNode = wsAudioContext.createGain();
    wsGainNode.gain.value = 1.0;

    pcmNode.connect(wsGainNode);
    wsGainNode.connect(wsAudioContext.destination);

    if (wsAudioContext.state === "suspended") await wsAudioContext.resume();
    console.log("[WS-AUDIO] AudioWorklet initialized at", nativeSampleRate, "Hz");
}

// ============== PUSH AUDIO ==============
function pushAudioData(samples) {
    if (!pcmNode || !wsAudioContext || !samples || samples.length === 0) return;

    samples = upsample24toNative(samples);

    if (!playbackStarted) {
        startupBuffer.push(samples);
        bufferedSamples += samples.length;

        if (bufferedSamples >= START_BUFFER_SAMPLES) {
            const merged = mergeFloat32Arrays(startupBuffer);
            appendSamples(merged);

            while (pendingBuffer.length >= FRAME_SIZE) {
                const frame = pendingBuffer.slice(0, FRAME_SIZE);
                pcmNode.port.postMessage(frame);
                pendingBuffer = pendingBuffer.slice(FRAME_SIZE);
            }

            const remainder = pendingBuffer;
            pendingBuffer = remainder;
            playbackStarted = true;
            startupBuffer = [];
            bufferedSamples = 0;
        }
        return;
    }

    appendSamples(samples);

    while (pendingBuffer.length >= FRAME_SIZE) {
        const frame = pendingBuffer.slice(0, FRAME_SIZE);
        pcmNode.port.postMessage(frame);
        pendingBuffer = pendingBuffer.slice(FRAME_SIZE);
    }
}

// ============== HANDLE INCOMING PCM ==============
function handleAudioData(pcmBytes) {
    const samples = new Float32Array(pcmBytes);
    pushAudioData(samples);
}

// ============== STOP AUDIO ==============
function stopAudio() {
    // Do NOT flush startupBuffer or pendingBuffer here.
    // If 'done' arrives before all binary WebSocket frames have been received
    // (race condition), those buffers contain only partial audio and flushing
    // them causes replayed or corrupted audio. The worklet drains itself
    // naturally from whatever was already posted to it.
    if (pcmNode && pcmNode.port) {
        pcmNode.port.postMessage({ type: "stop" });
    }
    pendingBuffer = new Float32Array(0);
    playbackStarted = false;
    startupBuffer = [];
    bufferedSamples = 0;
    isSpeaking = false;
    window.VoiceState.assistantSpeaking = false;
    window.VoiceState.tokenBuffer = '';
    window.VoiceState.llmStreaming = false;
    
    // Trigger TTS cooldown to prevent immediate voice detection
    if (typeof window.triggerTTSCooldown === 'function') {
        window.triggerTTSCooldown();
    }
    
    if (typeof updateConversationStatus === 'function') {
        updateConversationStatus('Ready to chat');
    }
    if (typeof showCircleIndicator === 'function') {
        showCircleIndicator('idle');
    }
}

// ============== WEBSOCKET CONNECTION ==============
async function connectWebSocket(sessionIdVal, speakerVal) {
    wsSessionId = sessionIdVal;
    currentSpeaker = speakerVal;

    if (ws && isConnected) {
        console.log('[WS-CLIENT] Already connected, reusing connection');
        // Reset worklet and all playback state for the new turn.
        // Without this, playbackStarted stays true from the prior turn,
        // causing the pre-buffer to be skipped and audio to underrun immediately.
        if (pcmNode && pcmNode.port) {
            pcmNode.port.postMessage({ type: 'reset' });
        }
        playbackStarted = false;
        startupBuffer = [];
        bufferedSamples = 0;
        pendingBuffer = new Float32Array(0);
        ws.send(JSON.stringify({
            type: 'config',
            session_id: wsSessionId,
            speaker: currentSpeaker
        }));
        return Promise.resolve();
    }

    if (pcmNode && pcmNode.port) {
        pcmNode.port.postMessage({ type: 'reset' });
    }
    playbackStarted = false;
    startupBuffer = [];
    bufferedSamples = 0;
    pendingBuffer = new Float32Array(0);

    await initAudioWorklet();

    ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        console.log("[WS-CLIENT] Connected");
        isConnected = true;
        ws.send(JSON.stringify({ type: "config", session_id: wsSessionId, speaker: currentSpeaker }));
        
        // Send any queued messages
        while (pendingMessages.length > 0) {
            const msg = pendingMessages.shift();
            if (msg.type === 'text') {
                addWSSystemMessage('user', msg.text);
                streamedContent = '';
                currentAssistantDiv = null;
                responseComplete = false;
                ws.send(JSON.stringify({ type: 'text', text: msg.text }));
            }
        }
    };

    ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
            handleAudioData(event.data);
            return;
        }
        const msg = JSON.parse(event.data);
        handleMessage(msg);
    };

    ws.onerror = (err) => console.error("[WS-CLIENT] Error:", err);
    ws.onclose = () => {
        console.log("[WS-CLIENT] Disconnected");
        isConnected = false;
        isSpeaking = false;
    };
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
            if (llmFirstTokenTime === 0) {
                llmFirstTokenTime = msg.time;
                console.log(`🕐 [WS] LLM first token: ${msg.time}ms`);
            }
            break;
            
        case 'llm_token':
            window.VoiceState.tokenBuffer += msg.token;
            window.VoiceState.llmStreaming = true;
            
            streamedContent += msg.token;
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
            
            if (shouldEmitChunk(window.VoiceState.tokenBuffer)) {
                sendTextToTTS(window.VoiceState.tokenBuffer);
                window.VoiceState.tokenBuffer = "";
            }
            break;
            
        case 'tts_start':
            firstAudioTime = msg.time;
            console.log(`🕐 [WS] TTS first chunk: ${firstAudioTime}ms`);
            
            const tokensGeneratedTts = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
            const tokenSpeedTts = (llmFirstTokenTime > 0 && tokensGeneratedTts > 0) 
                ? (tokensGeneratedTts / (firstAudioTime / 1000)) 
                : 0;
            
            if (typeof window.updateTimingSummary === 'function') {
                window.updateTimingSummary({
                    requestStart: totalStartTime,
                    total: firstAudioTime,
                    llm: llmFirstTokenTime > 0 ? llmFirstTokenTime : 0,
                    llmDone: firstAudioTime,
                    tts: firstAudioTime,
                    audioPlayStart: firstAudioTime,
                    tokens: tokensGeneratedTts,
                    tokensPerSecond: tokenSpeedTts
                });
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
            const audioBase64 = msg.data;
            if (!audioBase64) {
                console.warn('[WS-CLIENT] No audio data in message');
                break;
            }
            
            const audioBytes = atob(audioBase64);
            const wavBuffer = new ArrayBuffer(audioBytes.length);
            const wavUint8Array = new Uint8Array(wavBuffer);
            for (let i = 0; i < audioBytes.length; i++) {
                wavUint8Array[i] = audioBytes.charCodeAt(i);
            }
            
            if (typeof window.wsWavAudioContext === 'undefined') {
                window.wsWavAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            try {
                const audioBuffer = await window.wsWavAudioContext.decodeAudioData(wavBuffer.slice(0));
                const channelData = audioBuffer.getChannelData(0);
                
                if (!responseComplete && !isSpeaking) {
                    isSpeaking = true;
                    if (typeof updateConversationStatus === 'function') {
                        updateConversationStatus('🔊 Speaking...', 'speaking');
                    }
                    if (typeof showCircleIndicator === 'function') {
                        showCircleIndicator('speaking');
                    }
                }
                
                pushAudioData(channelData);
            } catch (e) {
                console.error('[WS-CLIENT] Failed to decode audio:', e);
            }
            break;
            
        case 'done':
            const totalTime = msg.total_time;
            console.log(` [WS] Total⏱️ response time: ${totalTime.toFixed(0)}ms`);
            
            responseComplete = true;
            window.VoiceState.llmStreaming = false;
            
            if (window.VoiceState.tokenBuffer.length > 0) {
                sendTextToTTS(window.VoiceState.tokenBuffer);
                window.VoiceState.tokenBuffer = '';
            }
            
            // Do NOT manually flush pendingBuffer here. Binary WebSocket frames
            // and JSON control messages share the same socket but are processed
            // in order — however stopAudio() resets state immediately, so any
            // binary frames that arrive after 'done' (due to OS socket buffering)
            // would be pushed into a reset worklet and replayed. Let the server-side
            // TTS drain wait (asyncio.sleep + queue drain) guarantee all audio
            // has been sent before this message arrives.
            
            const tokensGeneratedDone = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
            const tokenSpeedDone = (llmFirstTokenTime > 0 && tokensGeneratedDone > 0) 
                ? (tokensGeneratedDone / (totalTime / 1000)) 
                : 0;
            
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
            }
            
            stopAudio();
            
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Ready to chat');
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
            if (typeof window.triggerLLMCooldown === 'function') {
                window.triggerLLMCooldown();
            }
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Error: ' + msg.error);
            }
            break;
            
        case 'tts_audio':
            const pcmBase64 = msg.pcm;
            if (!pcmBase64) {
                console.warn('[WS-CLIENT] No PCM data in message');
                break;
            }
            
            const pcmBytes = atob(pcmBase64);
            const pcmBuffer = new ArrayBuffer(pcmBytes.length);
            const pcmUint8Array = new Uint8Array(pcmBuffer);
            for (let i = 0; i < pcmBytes.length; i++) {
                pcmUint8Array[i] = pcmBytes.charCodeAt(i);
            }
            
            const int16Array = new Int16Array(pcmBuffer);
            const float32Array = new Float32Array(int16Array.length);
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }
            
            if (!responseComplete && !isSpeaking) {
                isSpeaking = true;
                window.VoiceState.assistantSpeaking = true;
                if (typeof updateConversationStatus === 'function') {
                    updateConversationStatus('🔊 Speaking...', 'speaking');
                }
                if (typeof showCircleIndicator === 'function') {
                    showCircleIndicator('speaking');
                }
            }
            
            pushAudioData(float32Array);
            break;
    }
}


// ============== API FUNCTIONS ==============
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


window.wsConversationSend = function(text) {
    if (window.VoiceState.llmStreaming) {
        console.log('[WS-CLIENT] LLM already streaming, preventing request storm');
        return false;
    }
    
    if (!ws || !isConnected) {
        console.log('[WS-CLIENT] Queuing message, waiting for connection');
        pendingMessages.push({ type: 'text', text: text });
        return false;
    }
    
    try {
        addWSSystemMessage('user', text);
        
        // Reset all per-turn state so each new response starts clean.
        // If playbackStarted is left true from the prior turn, incoming
        // audio skips the pre-buffer and hits the worklet before it has
        // enough data queued, causing an immediate underrun and cutoff.
        streamedContent = '';
        currentAssistantDiv = null;
        responseComplete = false;
        llmFirstTokenTime = 0;
        firstAudioTime = 0;
        totalStartTime = performance.now();
        playbackStarted = false;
        startupBuffer = [];
        bufferedSamples = 0;
        pendingBuffer = new Float32Array(0);
        isSpeaking = false;
        window.VoiceState.tokenBuffer = '';
        
        ws.send(JSON.stringify({
            type: 'chat_stream',
            message: text
        }));
        
        window.VoiceState.llmStreaming = true;
        return true;
    } catch (e) {
        console.error('[WS-CLIENT] Send failed:', e);
        return false;
    }
};


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


window.wsConversationDisconnect = function() {
    if (ws) {
        ws.close();
        ws = null;
    }
    isConnected = false;
    isSpeaking = false;
    stopAudio();
};

function cancelLLMStream() {
    if (!ws) return;
    
    try {
        ws.send(JSON.stringify({
            type: "cancel_generation"
        }));
        
        window.VoiceState.llmStreaming = false;
        window.VoiceState.tokenBuffer = "";
        
        console.log('[WS-CLIENT] LLM stream cancelled');
    } catch (e) {
        console.error('[WS-CLIENT] Cancel failed:', e);
    }
}

window.cancelLLMStream = cancelLLMStream;

console.log('[WS-CLIENT] Loaded and ready');
