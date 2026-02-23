/**
 * LM Studio Chatbot - Voice Module
 * Voice recording, VAD, and conversation mode
 */

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
    conversationMode = !conversationMode;
    conversationToggle.classList.toggle('active', conversationMode);
    conversationControls.style.display = conversationMode ? 'block' : 'none';
    
    if (conversationMode) {
        conversationStatus.textContent = '🎙️ Voice Mode Active';
        micBtn.style.display = 'flex';
        messageInput.placeholder = 'Type or hold mic to speak...';
        switchToConversationView();
    } else {
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
    
    // Hide the circle indicator
    hideCircleIndicator();
    
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
        // Hide tap to talk button when auto is ON
        if (tapToTalkBtn) {
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
        
        // Show tap to talk button when auto is OFF
        if (tapToTalkBtn) {
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

// Start VAD recording
async function startVADRecording() {
    if (isRecording) return;
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        console.log('TTS interrupted by voice');
    }
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        audioChunks = [];
        
        // Use batch mode only - WebSocket streaming doesn't work with webm chunks
        // MediaRecorder produces chunks with individual headers that can't be concatenated
        
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            
            if (audioChunks.length > 0) {
                await transcribeVADAudio();
            }
        };
        
        // Start without timeslice - this produces a single valid webm file
        // Using timeslice creates chunks that can't be concatenated into valid webm
        mediaRecorder.start();
        isRecording = true;
        
        conversationMicBtn.classList.add('recording');
        micBtn.classList.add('recording');
        updateConversationStatus('🎤 Listening...', 'listening');
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
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    updateConversationStatus('🔄 Processing...', 'speaking');
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
    
    // Use unified voice WebSocket for real-time streaming pipeline
    if (USE_WEBSOCKET) {
        try {
            await sendVoiceText(text);
            return;
        } catch (e) {
            console.error('Voice WebSocket failed, falling back to REST:', e);
            // Fall through to REST
        }
    }
    
    // Fallback to streaming REST API
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
            span.textContent = showMessagesInConversation ? 'Messages' : 'Circle Only';
        }
    }
    
    if (showMessagesInConversation) {
        conversationMessages.classList.remove('hidden');
        conversationInputContainer.classList.add('active');
        conversationInputContainer.classList.remove('hidden');
    } else {
        conversationMessages.classList.add('hidden');
        conversationInputContainer.classList.remove('active');
        conversationInputContainer.classList.add('hidden');
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
    showCircleIndicator('speaking');
    updateConversationStatus('🔊 Speaking...', 'speaking');
    
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
            span.textContent = 'Circle Only';
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
    conversationChatView.classList.remove('active');
    messagesContainer.style.display = 'flex';
    welcomeMessage.classList.remove('hidden');
    document.querySelector('.input-area').classList.remove('conversation-active');
}

// Show circle indicator - show during speaking regardless of message visibility
function showCircleIndicator(state = 'idle') {
    // Always show circle when:
    // 1. Messages are hidden (circle-only mode), OR
    // 2. AI is speaking (animate during TTS playback)
    const shouldShowCircle = !showMessagesInConversation || state === 'speaking';
    
    if (shouldShowCircle) {
        // Show the outer container
        circleIndicator.classList.add('active');
        
        // Add animation class to inner circle-indicator element
        const innerCircle = circleIndicator.querySelector('.circle-indicator');
        if (innerCircle) {
            innerCircle.classList.remove('idle', 'listening', 'speaking');
            innerCircle.classList.add(state);
        }
    } else {
        // Hide circle when messages are visible and not speaking
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
    
    // Use unified voice WebSocket for real-time streaming pipeline
    if (USE_WEBSOCKET) {
        try {
            const handled = await sendVoiceTextWithFallback(message);
            if (handled) return; // WebSocket handled it successfully
        } catch (e) {
            console.error('Voice WebSocket failed:', e);
            // Fall through to REST
        }
    }
    
    // Fallback to REST API
    await sendConversationMessageREST(message, totalStartTime, sttDuration);
}

// Combined function that handles WebSocket with fallback
async function sendVoiceTextWithFallback(message) {
    console.log('[WS] sendVoiceTextWithFallback called');
    console.log('[WS] USE_WEBSOCKET:', USE_WEBSOCKET);
    console.log('[WS] voiceWs:', voiceWs);
    console.log('[WS] voiceWs.readyState:', voiceWs ? voiceWs.readyState : 'N/A');
    
    // Add user message to display
    addConversationMessage('user', message);
    conversationInput.value = '';
    conversationSendBtn.disabled = true;
    
    isLoading = true;
    
    // Connect if not connected
    if (!voiceWs || voiceWs.readyState !== WebSocket.OPEN) {
        console.log('[WS] WebSocket not connected, trying to connect...');
        try {
            await connectVoiceWebSocket();
            console.log('[WS] WebSocket connected successfully');
        } catch (e) {
            console.error('[WS] Failed to connect to voice pipeline:', e);
            isLoading = false;
            // Return false to trigger REST fallback
            return false;
        }
    }
    
    // Send text
    if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
        console.log('[WS] Sending message via WebSocket');
        voiceWs.send(JSON.stringify({
            type: "text",
            data: message
        }));
        return true; // WebSocket is handling it
    }
    
    console.log('[WS] WebSocket not ready, falling back to REST');
    isLoading = false;
    return false; // Fall back to REST
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

// TTS audio queue for sequential playback of sentence chunks
let ttsAudioQueue = [];
let ttsPlaying = false;
let ttsFetchQueue = []; // Pre-fetch audio while previous is playing

// Global audio playback control
let globalAudioPlayQueue = [];
let globalAudioPlaying = false;
let stopAudioRequested = false;

function enqueueTTS(text, speaker) {
    if (!text.trim()) return Promise.resolve();
    
    return new Promise((resolve) => {
        ttsAudioQueue.push({ text, speaker, resolve, audioPromise: null });
        
        // Start pre-fetching audio immediately (don't wait for playback)
        const item = ttsAudioQueue[ttsAudioQueue.length - 1];
        item.audioPromise = fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: item.text, speaker: item.speaker })
        }).then(r => r.json()).catch(e => {
            console.error('TTS fetch error:', e);
            return { success: false };
        });
        
        processTTSQueue();
    });
}

async function processTTSQueue() {
    if (ttsPlaying || ttsAudioQueue.length === 0) return;
    
    ttsPlaying = true;
    const item = ttsAudioQueue.shift();
    
    try {
        // Use pre-fetched audio data
        const data = await item.audioPromise;
        
        if (data && data.success && data.audio) {
            await playTTS(data.audio);
        }
    } catch (error) {
        console.error('TTS queue error:', error);
    } finally {
        ttsPlaying = false;
        item.resolve();
        // Process next in queue
        if (ttsAudioQueue.length > 0) {
            processTTSQueue();
        }
    }
}

function clearTTSQueue() {
    ttsAudioQueue = [];
    ttsPlaying = false;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
}

// Streaming conversation message via SSE with server-side threaded TTS
async function sendConversationMessageREST(message, totalStartTime = null, sttDuration = null) {
    if (!message || isLoading) return;
    
    // Reset stop flag at start of new conversation
    stopAudioRequested = false;
    
    // Start timing if not provided
    if (!totalStartTime) {
        totalStartTime = performance.now();
    }
    
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
        
        updateConversationStatus('🔊 Speaking...', 'speaking');
        showCircleIndicator('speaking');
        
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
                                    console.log(`🕐 [CLIENT] First LLM token at: ${llmStartTime - totalStartTime}ms (LLM is fast!)`);
                                }
                                streamedContent += data.content;
                                
                                // Update display immediately
                                contentDiv.textContent = streamedContent;
                                conversationMessages.scrollTop = conversationMessages.scrollTop;
                                
                            } else if (data.type === 'audio') {
                                // First audio chunk - this marks when first TTS audio arrived at client
                                if (!firstAudioReceivedTime) {
                                    firstAudioReceivedTime = performance.now();
                                    console.log(`🕐 [CLIENT] First audio at: ${firstAudioReceivedTime - totalStartTime}ms`);
                                    console.log(`🕐 [CLIENT] LLM was fast (~${llmStartTime - totalStartTime}ms), but TTS took ~${firstAudioReceivedTime - llmStartTime}ms to generate!`);
                                }
                                // Server generated TTS audio for a sentence - play it
                                enqueueAudio(data.audio, data.sample_rate);
                                
                            } else if (data.type === 'done') {
                                // LLM finished generating
                                llmEndTime = performance.now();
                                // Render final markdown
                                contentDiv.innerHTML = renderMarkdown(streamedContent);
                                
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
