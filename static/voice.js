// LM Studio Chatbot - Voice Module
// Voice recording, VAD, and conversation mode

// Voice Mode State
let conversationMode = false;
let alwaysListening = false;
let isRecording = false;
let isProcessing = false;
let currentAudio = null;
let vadAnalyser = null;
let vadAudioContext = null;
let vadStream = null;
let silenceTimer = null;
let audioContext = null;
let analyser = null;

// VAD Settings - Optimized for low latency
const VAD_SILENCE_THRESHOLD = 0.008;
const VAD_SILENCE_TIMEOUT = 800;
const VAD_MIN_AUDIO_LENGTH = 200;
const VAD_CHECK_INTERVAL = 50;

// Audio processing optimization
const AUDIO_CHUNK_SIZE = 80;

// MediaRecorder and audio chunks
let mediaRecorder = null;
let audioChunks = [];

const mediaRecorderSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

// DOM Elements for conversation mode
const conversationToggle = document.getElementById('conversationToggle');
const conversationControls = document.getElementById('conversationControls');
const conversationStatus = document.getElementById('conversationStatus');
const micBtn = document.getElementById('micBtn');
const exitConversationBtn = document.getElementById('exitConversationBtn');
const toggleMessagesBtn = document.getElementById('toggleMessagesBtn');
let showMessagesInConversation = true;

const conversationChatView = document.getElementById('conversationChatView');
const conversationMessages = document.getElementById('conversationMessages');
const circleIndicator = document.getElementById('circleIndicator');
const conversationStatusMessage = document.getElementById('conversationStatusMessage');
const conversationInputContainer = document.getElementById('conversationInputContainer');
const conversationMicBtn = document.getElementById('conversationMicBtn');
const conversationInput = document.getElementById('conversationInput');
const conversationSendBtn = document.getElementById('conversationSendBtn');
const alwaysListeningBtn = document.getElementById('alwaysListeningBtn');
const tapToTalkBtn = document.getElementById('tapToTalkBtn');

// Initialize conversation mode
function initConversationMode() {
    if (!mediaRecorderSupported) {
        console.log('MediaRecorder not supported in this browser');
        conversationToggle.title = 'Voice recording not supported';
        micBtn.disabled = true;
        return;
    }
}

// Toggle conversation mode
function toggleConversationMode() {
    console.log('[MODE] toggleConversationMode called, current conversationMode:', conversationMode);
    conversationMode = !conversationMode;
    console.log('[MODE] New conversationMode:', conversationMode);
    
    conversationToggle.classList.toggle('active', conversationMode);
    conversationControls.style.display = conversationMode ? 'block' : 'none';
    
    if (conversationMode) {
        console.log('[MODE] Entering conversation mode');
        conversationStatus.textContent = '🎙️ Voice Mode Active';
        micBtn.style.display = 'flex';
        messageInput.placeholder = 'Type or hold mic to speak...';
        switchToConversationView();
    } else {
        console.log('[MODE] Exiting conversation mode');
        conversationStatus.textContent = 'Voice Mode';
        micBtn.style.display = 'none';
        messageInput.placeholder = 'Type your message...';
        switchToRegularView();
    }
}

// Exit conversation mode
function exitConversationMode() {
    console.log('[VOICE] Exit conversation mode requested');
    
    // Signal all audio to stop
    stopAudioRequested = true;
    
    // Stop always listening first
    if (alwaysListening) {
        stopAlwaysListening();
    }
    
    // Stop any ongoing recording
    if (isRecording) {
        isRecording = false;
        conversationMicBtn.classList.remove('recording');
        micBtn.classList.remove('recording');
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
    }
    
    // Clear any pending timers
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    // Reset processing state
    isProcessing = false;
    
    // Stop any playing audio immediately
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
        console.log('[VOICE] Stopped current audio on exit');
    }
    
    // Clear global audio queue
    globalAudioPlayQueue = [];
    globalAudioPlaying = false;
    
    // Clear TTS queue
    clearTTSQueue();
    
    // Hide the circle indicator and tap to talk
    hideCircleIndicator();
    if (tapToTalkBtn) {
        tapToTalkBtn.classList.remove('visible');
    }
    
    conversationMode = false;
    alwaysListening = false;
    conversationToggle.classList.remove('active');
    conversationControls.style.display = 'none';
    conversationStatus.textContent = 'Voice Mode';
    micBtn.style.display = 'none';
    messageInput.placeholder = 'Type your message...';
    switchToRegularView();
}

// Toggle always listening
function toggleAlwaysListening() {
    alwaysListening = !alwaysListening;
    
    if (alwaysListeningBtn) {
        alwaysListeningBtn.classList.toggle('active', alwaysListening);
        
        // Update the label text
        const label = alwaysListeningBtn.querySelector('.auto-label');
        if (label) {
            label.textContent = alwaysListening ? 'Auto: ON' : 'Auto: OFF';
        }
    }
    
    if (alwaysListening) {
        // Hide tap to talk button when auto is ON (but only if messages are hidden)
        if (tapToTalkBtn && !showMessagesInConversation) {
            tapToTalkBtn.classList.remove('visible');
        }
        updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
        showCircleIndicator('listening');
        startAlwaysListening();
    } else {
        // Stop any ongoing recording immediately
        if (isRecording) {
            isRecording = false;
            conversationMicBtn.classList.remove('recording');
            micBtn.classList.remove('recording');
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }
        
        // Clear any pending timers
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
        
        // Reset processing state
        isProcessing = false;
        
        // Show tap to talk button when auto is OFF (but only if messages are hidden)
        if (tapToTalkBtn && !showMessagesInConversation) {
            tapToTalkBtn.classList.add('visible');
        }
        updateConversationStatus('Tap to speak');
        showCircleIndicator('idle');
        stopAlwaysListening();
    }
}

// Start tap to talk recording
async function startTapToTalkRecording() {
    if (!mediaRecorderSupported || !conversationMode || isRecording) return;
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        console.log('TTS interrupted by tap to talk');
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            
            if (audioChunks.length > 0) {
                await transcribeTapToTalkAudio();
            }
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        if (tapToTalkBtn) {
            tapToTalkBtn.classList.add('recording');
            tapToTalkBtn.querySelector('span').textContent = 'Listening...';
        }
        updateConversationStatus('🎤 Listening...', 'listening');
    } catch (e) {
        console.error('Failed to start tap to talk recording:', e);
        stopTapToTalkRecording();
    }
}

// Stop tap to talk recording
function stopTapToTalkRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    
    if (tapToTalkBtn) {
        tapToTalkBtn.classList.remove('recording');
        tapToTalkBtn.querySelector('span').textContent = 'Tap to Talk';
    }
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    updateConversationStatus('Processing...', 'speaking');
}

// Transcribe tap to talk audio
async function transcribeTapToTalkAudio() {
    if (audioChunks.length === 0) return;
    
    const sttStartTime = performance.now();
    
    try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        const response = await fetch('/api/stt', { method: 'POST', body: formData });
        const data = await response.json();
        
        const sttDuration = (performance.now() - sttStartTime).toFixed(0);
        console.log(`⏱️ [TIMING] STT (Audio → Text): ${sttDuration}ms`);
        
        if (data.success && data.text && data.text.trim()) {
            conversationInput.value = data.text;
            await processVADTranscript(data.text, sttDuration);
        } else {
            updateConversationStatus('Tap to speak');
            if (tapToTalkBtn) {
                tapToTalkBtn.classList.add('visible');
            }
        }
    } catch (error) {
        console.error('Tap to talk STT Error:', error);
        updateConversationStatus('Tap to speak');
        if (tapToTalkBtn) {
            tapToTalkBtn.classList.add('visible');
        }
    } finally {
        audioChunks = [];
    }
}

// Start always listening
async function startAlwaysListening() {
    if (!mediaRecorderSupported || !conversationMode) return;
    
    try {
        vadStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        vadAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = vadAudioContext.createMediaStreamSource(vadStream);
        analyser = vadAudioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        
        detectVoiceActivity();
        console.log('Always listening started');
    } catch (e) {
        console.error('Failed to start always listening:', e);
        stopAlwaysListening();
    }
}

// Detect voice activity
function detectVoiceActivity() {
    if (!alwaysListening || !analyser) return;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const average = sum / dataArray.length / 255;
    
    if (average > VAD_SILENCE_THRESHOLD) {
        if (!isRecording && !isProcessing) {
            console.log('Voice detected, starting recording');
            startVADRecording();
        }
        
        if (silenceTimer) {
            clearTimeout(silenceTimer);
            silenceTimer = null;
        }
    } else if (isRecording && !silenceTimer) {
        silenceTimer = setTimeout(() => {
            if (isRecording) {
                console.log('Silence detected, stopping recording');
                stopVADRecording();
            }
        }, VAD_SILENCE_TIMEOUT);
    }
    
    if (alwaysListening) {
        requestAnimationFrame(detectVoiceActivity);
    }
}

// Raw Float32 microphone capture using Web Audio API
// No Opus/WebM encoding - direct Float32 for cleanest audio path
let rawFloat32AudioContext = null;
let rawFloat32Source = null;
let rawFloat32Processor = null;
let rawFloat32Chunks = [];

// Start VAD recording with raw Float32 capture
async function startVADRecording() {
    if (isRecording) return;
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        console.log('TTS interrupted by voice');
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            } 
        });
        
        // Initialize Web Audio API for raw Float32 capture
        rawFloat32AudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 48000,
            latencyHint: 'interactive'
        });
        
        rawFloat32Source = rawFloat32AudioContext.createMediaStreamSource(stream);
        
        // Create ScriptProcessor for raw audio access
        // Buffer size 4096 is good compromise for latency vs CPU
        rawFloat32Processor = rawFloat32AudioContext.createScriptProcessor(4096, 1, 1);
        
        rawFloat32Chunks = [];
        
        rawFloat32Processor.onaudioprocess = (event) => {
            // Get raw Float32 samples directly from microphone
            const inputBuffer = event.inputBuffer.getChannelData(0); // Float32Array
            
            // Store chunk for batch STT when recording stops
            rawFloat32Chunks.push(new Float32Array(inputBuffer));
        };
        
        rawFloat32Source.connect(rawFloat32Processor);
        rawFloat32Processor.connect(rawFloat32AudioContext.destination); // Required for processing
        
        isRecording = true;
        
        conversationMicBtn.classList.add('recording');
        micBtn.classList.add('recording');
        updateConversationStatus('🎤 Listening...', 'listening');
        
        console.log('[VOICE] Raw Float32 capture started at 48kHz');
        
    } catch (e) {
        console.error('Failed to start VAD recording:', e);
    }
}

// Stop VAD recording
function stopVADRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    conversationMicBtn.classList.remove('recording');
    micBtn.classList.remove('recording');
    
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    // Stop raw Float32 capture
    if (rawFloat32Processor) {
        rawFloat32Processor.disconnect();
        rawFloat32Processor = null;
    }
    
    if (rawFloat32Source) {
        rawFloat32Source.disconnect();
        rawFloat32Source = null;
    }
    
    if (rawFloat32AudioContext) {
        rawFloat32AudioContext.close();
        rawFloat32AudioContext = null;
    }
    
    // Process captured raw Float32 audio
    if (rawFloat32Chunks.length > 0) {
        transcribeRawFloat32Audio();
    }
    
    updateConversationStatus('🔄 Processing...', 'speaking');
}

// Transcribe raw Float32 audio
async function transcribeRawFloat32Audio() {
    if (rawFloat32Chunks.length === 0) return;
    
    isProcessing = true;
    const sttStartTime = performance.now();
    
    try {
        // Concatenate all Float32 chunks into one buffer
        const totalLength = rawFloat32Chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const concatenated = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of rawFloat32Chunks) {
            concatenated.set(chunk, offset);
            offset += chunk.length;
        }
        
        console.log(`[VOICE] Sending ${totalLength} Float32 samples (${(totalLength / 48000).toFixed(2)}s) to STT`);
        
        // Send via HTTP POST as binary (WAV streaming only)
        const response = await fetch('/api/stt/float32', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-Sample-Rate': '48000'
            },
            body: concatenated.buffer
        });
        
        const data = await response.json();
        const sttDuration = (performance.now() - sttStartTime).toFixed(0);
        console.log(`⏱️ [TIMING] STT (Float32 Audio → Text): ${sttDuration}ms`);
        
        if (data.success && data.text && data.text.trim()) {
            conversationInput.value = data.text;
            await processVADTranscript(data.text, sttDuration);
        } else {
            updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
        }
    } catch (error) {
        console.error('Raw Float32 STT Error:', error);
        updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
    } finally {
        rawFloat32Chunks = [];
        isProcessing = false;
    }
}

// Transcribe VAD audio
async function transcribeVADAudio() {
    if (audioChunks.length === 0) return;
    
    isProcessing = true;
    const sttStartTime = performance.now();
    
    try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        const response = await fetch('/api/stt', { method: 'POST', body: formData });
        const data = await response.json();
        
        const sttDuration = (performance.now() - sttStartTime).toFixed(0);
        console.log(`⏱️ [TIMING] STT (Audio → Text): ${sttDuration}ms`);
        
        if (data.success && data.text && data.text.trim()) {
            conversationInput.value = data.text;
            await processVADTranscript(data.text, sttDuration);
        } else {
            updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
        }
    } catch (error) {
        console.error('VAD STT Error:', error);
        updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
    } finally {
        audioChunks = [];
        isProcessing = false;
    }
}

// Process VAD transcript
async function processVADTranscript(text, sttDuration = null) {
    if (!text.trim()) return;
    
    const totalStartTime = performance.now();
    
    // Use WAV streaming REST API only
    conversationInput.value = '';
    await sendConversationMessageREST(text, totalStartTime, sttDuration);
}

// Speak text with interruption
async function speakTextWithInterruption(text, speaker = 'en') {
    if (!text) return;
    
    if (conversationMode) {
        showCircleIndicator('speaking');
    }
    
    // Try streaming TTS first, fall back to batch
    if (ENABLE_STREAMING_TTS) {
        try {
            await speakTextStreaming(text, speaker);
            return;
        } catch (e) {
            console.log('Streaming TTS failed, trying batch:', e);
        }
    }
    
    // Batch TTS fallback
    try {
        const response = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, speaker: speaker })
        });
        
        const data = await response.json();
        
        if (data.success && data.audio) {
            await playTTS(data.audio);
        }
    } catch (error) {
        console.error('TTS Error:', error);
        if (conversationMode) {
            showCircleIndicator('idle');
            updateConversationStatus('Ready to chat');
        }
    }
}

// Stop always listening
function stopAlwaysListening() {
    alwaysListening = false;
    
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    if (vadStream) {
        vadStream.getTracks().forEach(track => track.stop());
        vadStream = null;
    }
    
    if (vadAudioContext) {
        vadAudioContext.close();
        vadAudioContext = null;
    }
    
    analyser = null;
    
    if (isRecording) {
        stopVADRecording();
    }
    
    console.log('Always listening stopped');
}

// Toggle messages visibility
function toggleMessagesVisibility() {
    showMessagesInConversation = !showMessagesInConversation;
    
    if (toggleMessagesBtn) {
        toggleMessagesBtn.classList.toggle('active', showMessagesInConversation);
        const span = toggleMessagesBtn.querySelector('span');
        if (span) {
            span.textContent = showMessagesInConversation ? 'Messages' : 'Conversation Mode';
        }
    }
    
    if (showMessagesInConversation) {
        conversationMessages.classList.remove('hidden');
        conversationInputContainer.classList.add('active');
        conversationInputContainer.classList.remove('hidden');
        
        // Hide circle indicator and tap to talk when messages are visible
        hideCircleIndicator();
        if (tapToTalkBtn) {
            tapToTalkBtn.classList.remove('visible');
        }
    } else {
        conversationMessages.classList.add('hidden');
        conversationInputContainer.classList.remove('active');
        conversationInputContainer.classList.add('hidden');
        
        // Show circle indicator and tap to talk when messages are hidden
        showCircleIndicator(alwaysListening ? 'listening' : 'idle');
        if (tapToTalkBtn && !alwaysListening) {
            tapToTalkBtn.classList.add('visible');
        } else if (tapToTalkBtn && alwaysListening) {
            // When auto is ON, tap-to-talk should be hidden
            tapToTalkBtn.classList.remove('visible');
        }
    }
}

// Setup conversation mode
function setupConversationMode() {
    initConversationMode();
    
    conversationToggle.addEventListener('click', () => { toggleConversationMode(); });
    
    if (exitConversationBtn) {
        exitConversationBtn.addEventListener('click', () => { exitConversationMode(); });
    }
    
    if (toggleMessagesBtn) {
        toggleMessagesBtn.addEventListener('click', () => { toggleMessagesVisibility(); });
    }
    
    if (alwaysListeningBtn) {
        alwaysListeningBtn.addEventListener('click', () => { toggleAlwaysListening(); });
    }
    
    micBtn.addEventListener('mousedown', startRecording);
    micBtn.addEventListener('mouseup', stopRecording);
    micBtn.addEventListener('mouseleave', stopRecording);
    
    micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
    micBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopRecording(); });
    
    // Tap to Talk button events
    if (tapToTalkBtn) {
        tapToTalkBtn.addEventListener('mousedown', startTapToTalkRecording);
        tapToTalkBtn.addEventListener('mouseup', stopTapToTalkRecording);
        tapToTalkBtn.addEventListener('mouseleave', stopTapToTalkRecording);
        
        tapToTalkBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startTapToTalkRecording(); });
        tapToTalkBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopTapToTalkRecording(); });
    }
    
    setupConversationViewInput();
}

// Play greeting when conversation mode starts
async function playConversationGreeting() {
    // Show speaking animation on circle FIRST (before any message handling)
    if (conversationMode) {
        showCircleIndicator('speaking');
        updateConversationStatus('🔊 Speaking...', 'speaking');
    }
    
    // Get the selected speaker/voice - check if ttsSpeaker exists and has a valid value
    let selectedSpeaker = 'default';
    if (ttsSpeaker && ttsSpeaker.value) {
        selectedSpeaker = ttsSpeaker.value;
    }
    console.log('[GREETING] Selected speaker from dropdown:', selectedSpeaker);
    
    // Try Flask backend first - it handles voice resolution properly
    try {
        console.log('[GREETING] Requesting greeting from Flask with speaker:', selectedSpeaker);
        const response = await fetch('/api/conversation/greeting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ speaker: selectedSpeaker })
        });
        const data = await response.json();
        
        if (data.success && data.audio) {
            console.log('[GREETING] Playing greeting via Flask:', data.text);
            addConversationMessageAI(data.text);
            await playTTS(data.audio, data.sample_rate);
            showCircleIndicator('idle');
            updateConversationStatus('Ready to chat');
            return true;
        }
    } catch (e) {
        console.log('[GREETING] Flask greeting failed:', e);
    }
    
    // No greeting available - return to idle
    showCircleIndicator('idle');
    updateConversationStatus('Ready to chat');
    return false;
}

// Add AI conversation message without hiding the circle
function addConversationMessageAI(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'conversation-message ai';
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'conversation-message-avatar';
    avatarDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17" stroke="currentColor" stroke-width="2"/><path d="M12 14.74C13.81 13.47 15 11.38 15 9C15 5.13 11.87 2 8 2" stroke="currentColor" stroke-width="2"/><path d="M12 17V21M8 23H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'conversation-message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    
    conversationMessages.appendChild(messageDiv);
    conversationMessages.scrollTop = conversationMessages.scrollHeight;
}

// Switch to conversation view
async function switchToConversationView() {
    // In WAV mode: Use REST API for conversation (audio via <audio> elements)
    // In WebSocket mode: Use WebSocket pipeline for conversation (streaming audio)
    // Default is WAV mode - which uses REST API + <audio> playback
    console.log('[VOICE] TTS_PLAYBACK_MODE:', window.TTS_PLAYBACK_MODE || 'wav');
    
    // Reset the stop flag when entering conversation mode
    stopAudioRequested = false;
    
    welcomeMessage.classList.add('hidden');
    messagesContainer.style.display = 'none';
    typingIndicator.style.display = 'none';
    
    conversationChatView.classList.add('active');
    
    // Default to circle-only mode (no messages shown)
    showMessagesInConversation = false;
    conversationMessages.classList.add('hidden');
    conversationInputContainer.classList.add('hidden');
    conversationInputContainer.classList.remove('active');
    
    // Update toggle button state
    if (toggleMessagesBtn) {
        toggleMessagesBtn.classList.remove('active');
        const span = toggleMessagesBtn.querySelector('span');
        if (span) {
            span.textContent = 'Conversation Mode';
        }
    }
    
    showCircleIndicator('idle');
    
    conversationStatusMessage.style.display = 'inline-block';
    conversationStatusMessage.textContent = 'Ready to chat';
    conversationStatusMessage.className = 'conversation-status-message';
    
    document.querySelector('.input-area').classList.add('conversation-active');
    
    conversationInput.focus();
    
    // Play greeting after view is set up
    await playConversationGreeting();
    
    // Enable auto-listening by default after greeting
    toggleAlwaysListening();
}

// Switch to regular view
function switchToRegularView() {
    console.log('[MODE] switchToRegularView called - exiting conversation mode');
    conversationChatView.classList.remove('active');
    messagesContainer.style.display = 'flex';
    welcomeMessage.classList.remove('hidden');
    document.querySelector('.input-area').classList.remove('conversation-active');
    
    // Hide circle indicator and tap to talk when exiting conversation mode
    hideCircleIndicator();
    if (tapToTalkBtn) {
        tapToTalkBtn.classList.remove('visible');
        console.log('[MODE] tapToTalkBtn visibility after switchToRegularView:', tapToTalkBtn.classList.contains('visible'));
    }
}

// Show circle indicator - only show when in conversation mode AND messages are hidden
function showCircleIndicator(state = 'idle') {
    console.log('[CIRCLE] showCircleIndicator called with state:', state, 'conversationMode:', conversationMode, 'showMessagesInConversation:', showMessagesInConversation);
    
    // Only show circle when in conversation mode AND messages are hidden
    const shouldShowCircle = conversationMode && !showMessagesInConversation;
    
    if (shouldShowCircle) {
        console.log('[CIRCLE] Showing circle indicator');
        // Show the outer container
        circleIndicator.classList.add('active');
        
        // Add animation class to inner circle-indicator element
        const innerCircle = circleIndicator.querySelector('.circle-indicator');
        if (innerCircle) {
            innerCircle.classList.remove('idle', 'listening', 'speaking');
            innerCircle.classList.add(state);
        }
    } else {
        console.log('[CIRCLE] Hiding circle indicator (not in conversation mode OR messages are visible)');
        // Hide circle when not in conversation mode OR when messages are visible
        circleIndicator.classList.remove('active');
        
        // Remove animation class from inner circle
        const innerCircle = circleIndicator.querySelector('.circle-indicator');
        if (innerCircle) {
            innerCircle.classList.remove('idle', 'listening', 'speaking');
        }
    }
}

// Hide circle indicator
function hideCircleIndicator() {
    console.log('[CIRCLE] hideCircleIndicator called');
    circleIndicator.classList.remove('active');
    const innerCircle = circleIndicator.querySelector('.circle-indicator');
    if (innerCircle) {
        innerCircle.classList.remove('idle', 'listening', 'speaking');
    }
}

// Update conversation status
function updateConversationStatus(message, type = '') {
    conversationStatusMessage.style.display = 'inline-block';
    conversationStatusMessage.textContent = message;
    conversationStatusMessage.className = 'conversation-status-message' + (type ? ' ' + type : '');
}

// Add conversation message
function addConversationMessage(role, content) {
    hideCircleIndicator();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `conversation-message ${role}`;
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'conversation-message-avatar';
    
    if (role === 'user') {
        avatarDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M20 21V19C20 16.7909 18.2091 15 16 15H8C5.79086 15 4 16.7909 4 19V21" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2"/></svg>`;
    } else {
        avatarDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17" stroke="currentColor" stroke-width="2"/><path d="M12 14.74C13.81 13.47 15 11.38 15 9C15 5.13 11.87 2 8 2" stroke="currentColor" stroke-width="2"/><path d="M12 17V21M8 23H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'conversation-message-content';
    contentDiv.textContent = content;
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    
    conversationMessages.appendChild(messageDiv);
    conversationMessages.scrollTop = conversationMessages.scrollHeight;
}

// Setup conversation view input
function setupConversationViewInput() {
    conversationInput.addEventListener('input', () => {
        conversationSendBtn.disabled = !conversationInput.value.trim() || isLoading;
    });
    
    conversationInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendConversationMessage();
        }
    });
    
    conversationSendBtn.addEventListener('click', sendConversationMessage);
    
    conversationMicBtn.addEventListener('mousedown', startConversationRecording);
    conversationMicBtn.addEventListener('mouseup', stopConversationRecording);
    conversationMicBtn.addEventListener('mouseleave', stopConversationRecording);
    
    conversationMicBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startConversationRecording(); });
    conversationMicBtn.addEventListener('touchend', (e) => { e.preventDefault(); stopConversationRecording(); });
}

// Send conversation message
async function sendConversationMessage() {
    const message = conversationInput.value.trim();
    
    if (!message || isLoading) return;
    
    // Start timing for typed messages (no STT)
    const totalStartTime = performance.now();
    const sttDuration = null; // No STT for typed messages
    
    // Use WAV streaming REST API only
    await sendConversationMessageREST(message, totalStartTime, sttDuration);
}

// Start conversation recording
async function startConversationRecording() {
    if (!mediaRecorderSupported || !conversationMode || isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            await transcribeConversationAudio();
        };
        
        // Start without timeslice - produces valid webm file
        mediaRecorder.start();
        
        isRecording = true;
        conversationMicBtn.classList.add('recording');
        conversationInput.value = '';
        updateConversationStatus('Listening...', 'listening');
    } catch (e) {
        console.error('Failed to start recording:', e);
        stopConversationRecording();
    }
}

// Stop conversation recording
function stopConversationRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    conversationMicBtn.classList.remove('recording');
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    updateConversationStatus('Processing...', 'speaking');
}

// Transcribe conversation audio
async function transcribeConversationAudio() {
    if (audioChunks.length === 0) return;
    
    const sttStartTime = performance.now();
    
    try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        const response = await fetch('/api/stt', { method: 'POST', body: formData });
        const data = await response.json();
        
        const sttDuration = (performance.now() - sttStartTime).toFixed(0);
        console.log(`⏱️ [TIMING] STT (Audio → Text): ${sttDuration}ms`);
        
        if (data.success && data.text) {
            conversationInput.value = data.text;
            conversationSendBtn.disabled = !data.text.trim();
            
            if (conversationMode && data.text.trim()) {
                // Pass timing info
                const totalStartTime = performance.now();
                await sendConversationMessageRESTFromMic(data.text, totalStartTime, sttDuration);
            }
        } else {
            updateConversationStatus('Could not understand. Try again.');
        }
    } catch (error) {
        console.error('STT Error:', error);
        updateConversationStatus('Error processing audio');
    }
}

// Start recording
async function startRecording() {
    if (!mediaRecorderSupported || !conversationMode || isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            await transcribeAudio();
        };
        
        // Start without timeslice - produces valid webm file
        mediaRecorder.start();
        
        isRecording = true;
        micBtn.classList.add('recording');
        messageInput.value = '';
        conversationStatus.textContent = '🎙️ Recording...';
    } catch (e) {
        console.error('Failed to start recording:', e);
        stopRecording();
    }
}

// Stop recording
function stopRecording() {
    if (!isRecording) return;
    
    isRecording = false;
    micBtn.classList.remove('recording');
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    conversationStatus.textContent = '🎙️ Voice Mode Active';
}

// Transcribe audio
async function transcribeAudio() {
    if (audioChunks.length === 0) return;
    
    conversationStatus.textContent = '🔄 Transcribing...';
    
    try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        
        const response = await fetch('/api/stt', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data.success && data.text) {
            messageInput.value = data.text;
            sendBtn.disabled = !data.text.trim();
            
            if (conversationMode && data.text.trim()) {
                sendMessage();
            }
        } else {
            console.error('STT failed:', data.error);
            conversationStatus.textContent = '🎙️ Voice Mode Active';
        }
    } catch (error) {
        console.error('STT Error:', error);
        conversationStatus.textContent = '🎙️ Voice Mode Active';
    }
}

// Variant of sendConversationMessageREST for microphone input (clears audioChunks)
async function sendConversationMessageRESTFromMic(message, totalStartTime, sttDuration) {
    // Clear audio chunks to prevent reprocessing
    audioChunks = [];
    
    // Call the main REST function
    await sendConversationMessageREST(message, totalStartTime, sttDuration);
}

// TTS audio queue - uses shared queue from chat.js
// Variables ttsAudioQueue, ttsIsPlayingQueue defined in chat.js

// Global audio playback control
let globalAudioPlayQueue = [];
let globalAudioPlaying = false;
let stopAudioRequested = false;

// Latency tracking for first audio optimization
let latencyTracking = {
    totalStartTime: null,
    llmFirstTokenTime: null,
    firstTTSReceivedTime: null,
    firstPlaybackStartTime: null,
    sttDuration: null
};

// Preload buffer for seamless streaming - keep 1-2 chunks ready
const PRELOAD_BUFFER_SIZE = 2;
let preloadedChunks = [];

// Use shared TTS queue functions from chat.js
// enqueueTTS, processTTSQueue, clearTTSQueue are defined in chat.js

// Streaming conversation message via SSE with server-side threaded TTS
async function sendConversationMessageREST(message, totalStartTime = null, sttDuration = null) {
    if (!message || isLoading) return;
    
    // Reset stop flag at start of new conversation
    stopAudioRequested = false;
    
    // Start timing if not provided
    if (!totalStartTime) {
        totalStartTime = performance.now();
    }
    
    // Initialize latency tracking for this conversation
    latencyTracking = {
        totalStartTime: totalStartTime,
        llmFirstTokenTime: null,
        firstTTSReceivedTime: null,
        firstPlaybackStartTime: null,
        sttDuration: sttDuration
    };
    
    addConversationMessage('user', message);
    conversationInput.value = '';
    conversationSendBtn.disabled = true;
    
    isLoading = true;
    updateConversationStatus('Thinking...', 'listening');
    showCircleIndicator('listening');
    
    // Create placeholder AI message for streaming
    const messageDiv = document.createElement('div');
    messageDiv.className = 'conversation-message ai';
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'conversation-message-avatar';
    avatarDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17" stroke="currentColor" stroke-width="2"/><path d="M12 14.74C13.81 13.47 15 11.38 15 9C15 5.13 11.87 2 8 2" stroke="currentColor" stroke-width="2"/><path d="M12 17V21M8 23H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'conversation-message-content';
    contentDiv.textContent = '';
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    conversationMessages.appendChild(messageDiv);
    
    let streamedContent = '';
    let llmStartTime = null;
    let llmEndTime = null;
    let firstContentReceivedTime = null;
    let firstAudioReceivedTime = null;
    let lastContentReceivedTime = null;
    
    // Use global audio playback queue
    globalAudioPlayQueue = [];
    globalAudioPlaying = false;
    let totalAudioPlayTime = 0;
    let audioPlayStartTime = 0;
    
    async function playNextAudio() {
        // Check if stop was requested
        if (stopAudioRequested) {
            globalAudioPlaying = false;
            globalAudioPlayQueue = [];
            return;
        }
        
        // If already playing or nothing in queue, just return
        if (globalAudioPlaying || globalAudioPlayQueue.length === 0) return;
        
        globalAudioPlaying = true;
        audioPlayStartTime = performance.now();
        
        // Track FIRST audio playback start time for latency logging
        if (!latencyTracking.firstPlaybackStartTime) {
            latencyTracking.firstPlaybackStartTime = audioPlayStartTime;
            
            // Log comprehensive first playback latency
            if (latencyTracking.totalStartTime) {
                const totalLatency = audioPlayStartTime - latencyTracking.totalStartTime;
                console.log(`⏱️ [LATENCY] ========== FIRST AUDIO PLAYBACK ==========`);
                console.log(`⏱️ [LATENCY] Total (User spoke → Audio plays): ${totalLatency.toFixed(0)}ms`);
                
                if (latencyTracking.sttDuration) {
                    console.log(`⏱️ [LATENCY] STT duration: ${latencyTracking.sttDuration}ms`);
                }
                if (latencyTracking.llmFirstTokenTime) {
                    const llmLatency = latencyTracking.llmFirstTokenTime - latencyTracking.totalStartTime;
                    console.log(`⏱️ [LATENCY] LLM first token: ${llmLatency.toFixed(0)}ms`);
                }
                if (latencyTracking.firstTTSReceivedTime) {
                    const ttsGenLatency = latencyTracking.firstTTSReceivedTime - (latencyTracking.llmFirstTokenTime || latencyTracking.totalStartTime);
                    console.log(`⏱️ [LATENCY] TTS generation: ${ttsGenLatency.toFixed(0)}ms`);
                }
                const networkLatency = audioPlayStartTime - (latencyTracking.firstTTSReceivedTime || latencyTracking.totalStartTime);
                console.log(`⏱️ [LATENCY] Network + decode + buffer: ${networkLatency.toFixed(0)}ms`);
                console.log(`⏱️ [LATENCY] Target: <=800ms for real-time feel`);
                console.log(`⏱️ [LATENCY] ===============================================`);
            }
        }
        
        const { audioBase64, sampleRate } = globalAudioPlayQueue.shift();
        try {
            await playTTS(audioBase64, sampleRate);
        } catch (e) {
            console.error('Audio playback error:', e);
        }
        
        // Check stop flag again after playback
        if (stopAudioRequested) {
            globalAudioPlaying = false;
            globalAudioPlayQueue = [];
            return;
        }
        
        totalAudioPlayTime += (performance.now() - audioPlayStartTime);
        globalAudioPlaying = false;
        
        // Immediately check for more in queue - recursive call without delay
        if (globalAudioPlayQueue.length > 0 && !stopAudioRequested) {
            // Use setTimeout to allow event loop to process
            setTimeout(() => playNextAudio(), 0);
        }
    }
    
    function enqueueAudio(audioBase64, sampleRate) {
        // Don't queue more audio if stop requested
        if (stopAudioRequested) return;
        
        globalAudioPlayQueue.push({ audioBase64, sampleRate });
        
        if (conversationMode) {
            updateConversationStatus('🔊 Speaking...', 'speaking');
            showCircleIndicator('speaking');
        }
        
        // Always try to start playback - if already playing, playNextAudio will return early
        // but when current audio finishes, it will check queue and play next
        playNextAudio();
    }
    
    try {
        // Get combined system prompt (global + voice personality)
        const speaker = ttsSpeaker.value;
        let systemPrompt = null;
        
        // Use the combined system prompt if available
        if (typeof getCombinedSystemPrompt === 'function') {
            systemPrompt = getCombinedSystemPrompt(speaker);
            console.log('[VOICE] Using combined system prompt for speaker:', speaker);
        }
        
        const response = await fetch('/api/chat/voice-stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                session_id: sessionId,
                model: modelSelect.value,
                speaker: speaker,
                system_prompt: systemPrompt
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let totalBytesReceived = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            totalBytesReceived += value.length;
            sseBuffer += decoder.decode(value, { stream: true });
            
            // Process complete lines (SSE events end with \n\n)
            let boundary;
            while ((boundary = sseBuffer.indexOf('\n\n')) !== -1) {
                const eventBlock = sseBuffer.substring(0, boundary);
                sseBuffer = sseBuffer.substring(boundary + 2);
                
                for (const line of eventBlock.split('\n')) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr.trim() === '') continue;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            
                            if (data.type === 'content') {
                                // First content chunk marks LLM response start
                                if (!llmStartTime) {
                                    llmStartTime = performance.now();
                                    latencyTracking.llmFirstTokenTime = llmStartTime;
                                    console.log(`🕐 [CLIENT] First LLM token at: ${(llmStartTime - totalStartTime).toFixed(0)}ms (LLM is fast!)`);
                                }
                                streamedContent += data.content;
                                
                                // Update display immediately
                                contentDiv.textContent = streamedContent;
                                conversationMessages.scrollTop = conversationMessages.scrollTop;
                                
                            } else if (data.type === 'audio') {
                                // First audio chunk - this marks when first TTS audio arrived at client
                                if (!firstAudioReceivedTime) {
                                    firstAudioReceivedTime = performance.now();
                                    latencyTracking.firstTTSReceivedTime = firstAudioReceivedTime;
                                    console.log(`🕐 [CLIENT] First audio at: ${(firstAudioReceivedTime - totalStartTime).toFixed(0)}ms`);
                                    if (llmStartTime) {
                                        console.log(`🕐 [CLIENT] TTS generation took: ${(firstAudioReceivedTime - llmStartTime).toFixed(0)}ms`);
                                    }
                                }
                                // Server generated TTS audio for a sentence - play it
                                enqueueAudio(data.audio, data.sample_rate);
                                
                            } else if (data.type === 'tts_sentence') {
                                // Streaming sentence TTS - audio for a complete sentence
                                if (!firstAudioReceivedTime) {
                                    firstAudioReceivedTime = performance.now();
                                    latencyTracking.firstTTSReceivedTime = firstAudioReceivedTime;
                                    console.log(`🕐 [CLIENT] First sentence TTS at: ${(firstAudioReceivedTime - totalStartTime).toFixed(0)}ms`);
                                    if (llmStartTime) {
                                        console.log(`🕐 [CLIENT] Time from LLM start to first TTS: ${(firstAudioReceivedTime - llmStartTime).toFixed(0)}ms`);
                                    }
                                }
                                // Queue the sentence audio for sequential playback
                                console.log(`🔊 [TTS] Received sentence ${data.index}: "${data.text?.substring(0, 30)}..."`);
                                enqueueAudio(data.audio, data.sample_rate);
                                
                            } else if (data.type === 'done') {
                                // LLM finished generating
                                llmEndTime = performance.now();
                                // Render final markdown
                                contentDiv.innerHTML = renderMarkdown(streamedContent);
                                
                                // For conversation mode, speak the response
                                if (conversationMode && streamedContent) {
                                    // Get the selected speaker from the dropdown
                                    const speakerSelect = document.getElementById('ttsSpeaker');
                                    const selectedSpeaker = speakerSelect ? speakerSelect.value : 'en';
                                    await speakText(streamedContent, selectedSpeaker);
                                }
                                
                            } else if (data.type === 'error') {
                                contentDiv.textContent = data.error || 'An error occurred';
                                updateConversationStatus('Error - Try again');
                            }
                        } catch (e) {
                            console.error('Error parsing SSE:', e);
                        }
                    }
                }
            }
        }
        
        // Wait for all queued audio to finish playing (or stop requested)
        while ((globalAudioPlaying || globalAudioPlayQueue.length > 0) && !stopAudioRequested) {
            await new Promise(r => setTimeout(r, 100));
        }
        
        // Calculate and log timing summary
        const totalEndTime = performance.now();
        const totalDuration = (totalEndTime - totalStartTime).toFixed(0);
        
        const sttMs = sttDuration ? `${sttDuration}ms` : 'N/A';
        const llmMs = llmStartTime && llmEndTime 
            ? `${(llmEndTime - llmStartTime).toFixed(0)}ms` 
            : (llmStartTime ? `${(performance.now() - llmStartTime).toFixed(0)}ms` : 'N/A');
        const ttsGenMs = firstAudioReceivedTime && llmStartTime
            ? `${(firstAudioReceivedTime - llmStartTime).toFixed(0)}ms`
            : 'N/A';
        const ttsPlayMs = totalAudioPlayTime > 0 
            ? `${(totalAudioPlayTime).toFixed(0)}ms` 
            : 'N/A';
        
        console.log(`⏱️========== TIMING SUMMARY ==========`);
        console.log(`⏱️ [TOTAL] Audio → Response: ${totalDuration}ms`);
        console.log(`⏱️ [STT]   Audio → Text: ${sttMs}`);
        console.log(`⏱️ [LLM]   Text → Text: ${llmMs}`);
        console.log(`⏱️ [TTS]   First audio gen: ${ttsGenMs}`);
        console.log(`⏱️ [TTS]   Playback time: ${ttsPlayMs}`);
        console.log(`⏱️====================================`);
        
        updateConversationStatus('Ready to chat');
        showCircleIndicator('idle');
        
    } catch (error) {
        console.error('Conversation stream error:', error);
        contentDiv.textContent = 'Failed to connect to the server';
        updateConversationStatus('Connection error');
    } finally {
        isLoading = false;
        
        if (alwaysListening) {
            updateConversationStatus('🎤 Auto-listening - Speak now!', 'listening');
            showCircleIndicator('listening');
        } else {
            // Show tap to talk button when auto is OFF
            updateConversationStatus('Tap to speak');
            if (tapToTalkBtn) {
                tapToTalkBtn.classList.add('visible');
            }
        }
        
        renderSessionList();
    }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupConversationMode);
} else {
    setupConversationMode();
}
