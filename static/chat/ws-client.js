/**
 * LM Studio Chatbot - FastAPI WebSocket Client
 * Ultra-low-latency voice conversation using WebSocket + AudioWorklet
 * Replaces HTTP streaming with binary WebSocket for sub-500ms latency
 */

console.log('[WS-CLIENT] Starting to load...');

// ============== CONFIG ==============
const WS_URL = `ws://${window.location.host}/ws/conversation`;
const SAMPLE_RATE = 24000;
let FRAME_SIZE = 960;
const START_BUFFER_SAMPLES = 2400;

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

function appendSamples(samples) {
    const merged = new Float32Array(pendingBuffer.length + samples.length);
    merged.set(pendingBuffer, 0);
    merged.set(samples, pendingBuffer.length);
    pendingBuffer = merged;
}

function upsample24toNative(pcm24) {
    const factor = nativeSampleRate / SAMPLE_RATE;
    if (factor === 1) return pcm24;

    const out = new Float32Array(Math.floor(pcm24.length * factor));
    for (let i = 0; i < pcm24.length - 1; i++) {
        const start = pcm24[i];
        const end = pcm24[i + 1];
        for (let j = 0; j < factor; j++) {
            out[i * factor + j] = start + (end - start) * (j / factor);
        }
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
    let samples = new Float32Array(pcmBytes);

    const expected = 4800;
    if (samples.length !== expected) {
        const fixed = new Float32Array(expected);
        fixed.set(samples.subarray(0, Math.min(samples.length, expected)));
        samples = fixed;
    }

    pushAudioData(samples);
}

// ============== STOP AUDIO ==============
function stopAudio() {
    if (pcmNode && pcmNode.port) pcmNode.port.postMessage({ type: "stop" });
    pendingBuffer = new Float32Array(0);
    playbackStarted = false;
    startupBuffer = [];
    bufferedSamples = 0;
    isSpeaking = false;
    
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
                
                const int16Array = new Int16Array(channelData.length);
                for (let i = 0; i < channelData.length; i++) {
                    int16Array[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
                }
                
                if (firstAudioTime === 0) {
                    firstAudioTime = performance.now() - totalStartTime;
                    console.log(`🕐 [WS] First audio: ${firstAudioTime.toFixed(0)}ms`);
                    
                    const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
                    const tokenSpeed = (llmFirstTokenTime > 0 && tokensGenerated > 0) 
                        ? (tokensGenerated / (firstAudioTime / 1000)) 
                        : 0;
                    
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
                    }
                }
                
                if (!responseComplete && !isSpeaking) {
                    isSpeaking = true;
                    if (typeof updateConversationStatus === 'function') {
                        updateConversationStatus('🔊 Speaking...', 'speaking');
                    }
                    if (typeof showCircleIndicator === 'function') {
                        showCircleIndicator('speaking');
                    }
                }
                
                pushAudioData(int16Array.buffer);
            } catch (e) {
                console.error('[WS-CLIENT] Failed to decode audio:', e);
            }
            break;
            
        case 'done':
            const totalTime = msg.total_time;
            console.log(` [WS] Total⏱️ response time: ${totalTime.toFixed(0)}ms`);
            
            responseComplete = true;
            
            // Flush remaining audio before stopping
            if (pendingBuffer.length > 0 && pcmNode && pcmNode.port) {
                pcmNode.port.postMessage(pendingBuffer);
                pendingBuffer = new Float32Array(0);
            }
            
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
            if (typeof updateConversationStatus === 'function') {
                updateConversationStatus('Error: ' + msg.error);
            }
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
    if (!ws || !isConnected) {
        console.log('[WS-CLIENT] Queuing message, waiting for connection');
        pendingMessages.push({ type: 'text', text: text });
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


console.log('[WS-CLIENT] Loaded and ready');
