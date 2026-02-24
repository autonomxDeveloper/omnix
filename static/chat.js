/**
 * LM Studio Chatbot - Chat Module
 * Session management and chat functionality
 */

// Current audio element for playback - SEPARATE from voice.js currentAudio
let chatCurrentAudio = null;

// Load sessions
async function loadSessions() {
    try {
        const response = await fetch('/api/sessions');
        const data = await response.json();
        
        if (data.success) {
            sessions = data.sessions || [];
            renderSessionList();
            
            if (sessions.length > 0) {
                sessionId = sessions[0].id;
                await loadSession(sessionId);
            } else {
                await createNewSession();
            }
        }
    } catch (error) {
        console.error('Error loading sessions:', error);
        await createNewSession();
    }
}

// Render session list
function renderSessionList() {
    sessionList.innerHTML = '';
    
    // Also render collapsed session list
    const collapsedSessionList = document.getElementById('sidebarCollapsedSessionList');
    if (collapsedSessionList) {
        collapsedSessionList.innerHTML = '';
    }
    
    sessions.forEach(s => {
        const item = document.createElement('div');
        item.className = `session-item ${s.id === sessionId ? 'active' : ''}`;
        item.innerHTML = `
            <span class="session-title">${s.title || 'New Chat'}</span>
            <button class="session-delete" title="Delete">×</button>
        `;
        
        item.addEventListener('click', (e) => {
            if (!e.target.classList.contains('session-delete')) {
                switchSession(s.id);
            }
        });
        
        item.querySelector('.session-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(s.id);
        });
        
        sessionList.appendChild(item);
        
        // Render collapsed session item (icon with tooltip)
        if (collapsedSessionList) {
            const collapsedItem = document.createElement('button');
            collapsedItem.className = `sidebar-collapsed-session-item ${s.id === sessionId ? 'active' : ''}`;
            collapsedItem.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span class="session-tooltip">${s.title || 'New Chat'}</span>
            `;
            
            // Position tooltip on hover
            collapsedItem.addEventListener('mouseenter', (e) => {
                const tooltip = collapsedItem.querySelector('.session-tooltip');
                if (tooltip) {
                    const rect = collapsedItem.getBoundingClientRect();
                    tooltip.style.left = rect.right + 8 + 'px';
                    tooltip.style.top = rect.top + (rect.height / 2) + 'px';
                    tooltip.style.transform = 'translateY(-50%)';
                }
            });
            
            collapsedItem.addEventListener('click', () => {
                switchSession(s.id);
            });
            
            collapsedSessionList.appendChild(collapsedItem);
        }
    });
}

// Create new session
async function createNewSession() {
    try {
        const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        
        if (data.success) {
            sessionId = data.session_id;
            messagesContainer.innerHTML = '';
            welcomeMessage.classList.remove('hidden');
            await loadSessions();
        }
    } catch (error) {
        console.error('Error creating session:', error);
    }
}

// Switch session
async function switchSession(id) {
    sessionId = id;
    await loadSession(id);
    renderSessionList();
}

// Load session
async function loadSession(id) {
    try {
        const response = await fetch(`/api/sessions/${id}`);
        const data = await response.json();
        
        if (data.success) {
            messagesContainer.innerHTML = '';
            
            const session = data.session;
            const messages = session.messages || [];
            
            if (messages.length === 0) {
                welcomeMessage.classList.remove('hidden');
            } else {
                welcomeMessage.classList.add('hidden');
                
                messages.forEach(msg => {
                    if (msg.role !== 'system') {
                        addMessage(msg.role, msg.content, msg.thinking || null);
                    }
                });
            }
            
            if (session.system_prompt) {
                systemPromptInput.value = session.system_prompt;
            }
        }
    } catch (error) {
        console.error('Error loading session:', error);
    }
}

// Delete session
async function deleteSession(id) {
    try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        await loadSessions();
    } catch (error) {
        console.error('Error deleting session:', error);
    }
}

// Load system prompt
async function loadSystemPrompt() {
    if (!sessionId) return;
    
    try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        const data = await response.json();
        
        if (data.success && data.session.system_prompt) {
            systemPromptInput.value = data.session.system_prompt;
        } else {
            systemPromptInput.value = 'You are a helpful AI assistant.';
        }
    } catch (error) {
        systemPromptInput.value = 'You are a helpful AI assistant.';
    }
}

// Save system prompt
async function saveSystemPromptHandler() {
    try {
        await fetch(`/api/sessions/${sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_prompt: systemPromptInput.value })
        });
    } catch (error) {
        console.error('Error saving system prompt:', error);
    }
}

// Clear chat
async function clearChat() {
    messagesContainer.innerHTML = '';
    welcomeMessage.classList.remove('hidden');
    
    try {
        await fetch('/api/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId })
        });
    } catch (error) {
        console.error('Error clearing session:', error);
    }
    
    messageInput.focus();
}

// Add message to chat
function addMessage(role, content, thinking = null, tokens = null, tokensPerSec = '') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    if (role === 'ai') {
        if (thinking) {
            const thinkingContainer = document.createElement('div');
            thinkingContainer.className = 'thinking-container collapsed';
            
            const thinkingHeader = document.createElement('div');
            thinkingHeader.className = 'thinking-header';
            thinkingHeader.innerHTML = `
                <span class="thinking-toggle">▶ Thinking</span>
                <span class="thinking-label">(${thinking.length} chars)</span>
            `;
            
            const thinkingContent = document.createElement('div');
            thinkingContent.className = 'thinking-content';
            thinkingContent.textContent = thinking;
            
            thinkingHeader.addEventListener('click', () => {
                thinkingContainer.classList.toggle('collapsed');
                thinkingHeader.querySelector('.thinking-toggle').textContent = 
                    thinkingContainer.classList.contains('collapsed') ? '▶ Thinking' : '▼ Thinking';
            });
            
            thinkingContainer.appendChild(thinkingHeader);
            thinkingContainer.appendChild(thinkingContent);
            messageDiv.appendChild(thinkingContainer);
        }
        
        let headerHTML = `<span class="message-label">AI</span>`;
        if (tokens) {
            headerHTML += `<span class="token-info">${tokens.completion || 0} tokens`;
            if (tokensPerSec) {
                headerHTML += ` • ${tokensPerSec} tok/s`;
            }
            headerHTML += '</span>';
        }
        headerHTML += `<button class="speak-btn" title="Speak">Speak</button>`;
        headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        headerDiv.innerHTML = headerHTML;
        
        headerDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
            copyToClipboard(content, e.target);
        });
        
        headerDiv.querySelector('.speak-btn').addEventListener('click', (e) => {
            speakText(content, ttsSpeaker ? ttsSpeaker.value : 'en');
        });
        
        messageDiv.appendChild(headerDiv);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = renderMarkdown(content);
        messageDiv.appendChild(contentDiv);
    } else {
        const textContent = document.createElement('span');
        textContent.textContent = content;
        messageDiv.appendChild(textContent);
    }
    
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

// Extract thinking from streamed content
function extractThinkingFromContent(content) {
    if (!content) return { thinking: '', content: '' };
    
    const lines = content.split('\n');
    let thinkingLines = [];
    let answerLines = [];
    let foundThinkingMarker = false;
    
    for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i].trim();
        
        if (stripped && /^\d+\.\s/.test(stripped)) {
            if (!foundThinkingMarker && i > 0) {
                const prevLines = lines.slice(0, i).join('\n');
                const markers = ['analyze', 'identify', 'determine', 'formulate', 'check', 'output'];
                if (markers.some(m => prevLines.toLowerCase().includes(m))) {
                    thinkingLines = lines.slice(0, i);
                    answerLines = lines.slice(i);
                    foundThinkingMarker = true;
                    continue;
                }
            }
        }
        
        if (!foundThinkingMarker) {
            const markers = ['analyze', 'identify the intent', 'determine the answer', 'formulate', 'final output'];
            if (markers.some(m => stripped.toLowerCase().includes(m))) {
                thinkingLines = lines.slice(0, i);
                answerLines = lines.slice(i);
                foundThinkingMarker = true;
            }
        }
    }
    
    if (thinkingLines.length > 0 && answerLines.length > 0) {
        const thinkingText = thinkingLines.join('\n').trim();
        const answerText = answerLines.join('\n').trim();
        
        const markers = ['analyze', 'identify', 'determine', 'formulate', 'check', 'output'];
        if (thinkingText.length > 20 && markers.some(m => thinkingText.toLowerCase().includes(m))) {
            return { thinking: thinkingText, content: answerText };
        }
    }
    
    if (content.toLowerCase().includes('</thinking>')) {
        const parts = content.split(/<\/thinking>/i);
        if (parts.length > 1) {
            return { thinking: parts[0].trim(), content: parts[1].trim() };
        }
    }
    
    return { thinking: '', content: content };
}

// Audio queue for sequential playback (shared with voice.js)
let audioPlaybackQueue = [];
let isPlayingAudio = false;

// Play audio chunks sequentially
async function playAudioQueue() {
    if (isPlayingAudio) return;
    isPlayingAudio = true;
    
    while (audioPlaybackQueue.length > 0) {
        const { audio, sampleRate } = audioPlaybackQueue.shift();
        try {
            await playTTS(audio, sampleRate);
        } catch (e) {
            console.error('[TTS] Playback error:', e);
        }
    }
    
    isPlayingAudio = false;
}

// Send message with streaming support - includes streaming TTS
async function sendMessage() {
    const message = messageInput.value.trim();
    
    if (!message || isLoading) return;
    
    welcomeMessage.classList.add('hidden');
    addMessage('user', message);
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
isLoading = true;
    statusDot.className = 'status-dot loading';
    statusText.textContent = 'Thinking...';
    typingIndicator.style.display = 'flex';
    
    const startTime = Date.now();
    
    // Start token rate tracking
    if (window.features && window.features.startTokenRateTracking) {
        window.features.startTokenRateTracking();
    }
    
    // Clear audio queue
    audioPlaybackQueue = [];
    isPlayingAudio = false;
    
    // Create placeholder AI message for streaming
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-label">AI</span>
            <span class="tts-playing" style="display: none;">🔊 Speaking...</span>
            <button class="speak-btn" title="Speak">Speak</button>
            <button class="copy-btn" title="Copy">Copy</button>
        </div>
        <div class="message-content streaming"></div>
    `;
    messagesContainer.appendChild(messageDiv);
    
    let streamedContent = '';
    let thinkingContent = '';
    let audioChunkCount = 0;
    
    // Use voice-stream endpoint for streaming TTS only in conversation mode
    // In regular chat mode, user must click "Speak" button to hear audio
    const useStreamingTTS = false; // Disabled for regular chat - user clicks Speak instead
    const endpoint = '/api/chat/stream';
    
try {
        // Get the system prompt - combine global prompt with voice personality if set
        let systemPrompt = systemPromptInput?.value || 'You are a helpful AI assistant.';
        
        // If a voice/speaker is selected and has a personality profile, use combined prompt
        if (typeof ttsSpeaker !== 'undefined' && ttsSpeaker && ttsSpeaker.value && window.features) {
            const voiceId = ttsSpeaker.value;
            const voiceProfile = window.features.getVoiceProfile(voiceId);
            if (voiceProfile && voiceProfile.personality) {
                systemPrompt = window.features.getCombinedSystemPrompt(voiceId);
                console.log(`Using personality for voice: ${voiceProfile.name}`);
            }
        }
        
        const requestBody = {
            message: message,
            session_id: sessionId,
            model: modelSelect.value,
            system_prompt: systemPrompt
        };
        
        // Add speaker for voice-stream endpoint
        if (useStreamingTTS && ttsSpeaker) {
            requestBody.speaker = ttsSpeaker.value;
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = ''; // Buffer for incomplete SSE events
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            // Append new data to buffer
            sseBuffer += decoder.decode(value, { stream: true });
            
            // Process complete SSE events (separated by double newlines)
            const events = sseBuffer.split('\n\n');
            
            // Keep the last incomplete event in the buffer
            sseBuffer = events.pop() || '';
            
            for (const event of events) {
                // Find the data line within the event
                const lines = event.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (dataStr.trim() === '') continue;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            
                            if (data.type === 'content') {
                                streamedContent += data.content;
                                
                                // Display immediately using textContent - no HTML escaping needed
                                const contentEl = messageDiv.querySelector('.message-content');
                                contentEl.textContent = streamedContent;
                                scrollToBottom();
                            } else if (data.type === 'audio') {
                                // Queue audio chunk for sequential playback
                                audioPlaybackQueue.push({
                                    audio: data.audio,
                                    sampleRate: data.sample_rate
                                });
                                audioChunkCount++;
                                
                                // Show speaking indicator
                                const ttsIndicator = messageDiv.querySelector('.tts-playing');
                                if (ttsIndicator) ttsIndicator.style.display = 'inline-flex';
                                
                                // Start playing if not already
                                if (!isPlayingAudio) {
                                    playAudioQueue();
                                }
} else if (data.type === 'done') {
                                console.log('[TOKEN] Done event received. streamedContent length:', streamedContent?.length);
                                const { thinking, content } = extractThinkingFromContent(streamedContent);
                                thinkingContent = thinking;
                                streamedContent = content;
                                
                                // Update token counter from text content (estimate)
                                const generationTimeMs = startTime ? (Date.now() - startTime) : null;
                                console.log('[TOKEN] Updating tokens, time:', generationTimeMs, 'user:', message?.length, 'ai:', streamedContent?.length);
                                console.log('[TOKEN] window.updateTokenCounterFromText:', typeof window.updateTokenCounterFromText);
                                console.log('[TOKEN] window.features:', window.features ? 'exists' : 'missing');
                                
                                try {
                                    if (typeof window.updateTokenCounterFromText === 'function') {
                                        window.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                        console.log('[TOKEN] Called window.updateTokenCounterFromText');
                                    } else if (window.features && typeof window.features.updateTokenCounterFromText === 'function') {
                                        window.features.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                        console.log('[TOKEN] Called window.features.updateTokenCounterFromText');
                                    } else {
                                        console.warn('[TOKEN] updateTokenCounterFromText not found! Checking globals...');
                                        console.log('[TOKEN] Global functions:', Object.keys(window).filter(k => k.toLowerCase().includes('token')));
                                    }
                                } catch (e) {
                                    console.error('[TOKEN] Error calling updateTokenCounterFromText:', e);
                                }
                                
                                // Rebuild message with proper structure
                                messageDiv.innerHTML = '';
                                
                                if (thinkingContent) {
                                    const thinkingContainer = document.createElement('div');
                                    thinkingContainer.className = 'thinking-container collapsed';
                                    
                                    const thinkingHeader = document.createElement('div');
                                    thinkingHeader.className = 'thinking-header';
                                    thinkingHeader.innerHTML = `
                                        <span class="thinking-toggle">▶ Thinking</span>
                                        <span class="thinking-label">(${thinkingContent.length} chars)</span>
                                    `;
                                    
                                    const thinkingContentDiv = document.createElement('div');
                                    thinkingContentDiv.className = 'thinking-content';
                                    thinkingContentDiv.textContent = thinkingContent;
                                    
                                    thinkingHeader.addEventListener('click', () => {
                                        thinkingContainer.classList.toggle('collapsed');
                                        thinkingHeader.querySelector('.thinking-toggle').textContent = 
                                            thinkingContainer.classList.contains('collapsed') ? '▶ Thinking' : '▼ Thinking';
                                    });
                                    
                                    thinkingContainer.appendChild(thinkingHeader);
                                    thinkingContainer.appendChild(thinkingContentDiv);
                                    messageDiv.appendChild(thinkingContainer);
                                }
                                
                                let headerHTML = `<span class="message-label">AI</span>`;
                                if (audioChunkCount > 0) {
                                    headerHTML += `<span class="tts-playing" style="display: none;">🔊 Speaking...</span>`;
                                }
                                headerHTML += `<button class="speak-btn" title="Speak">Speak</button>`;
                                headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
                                
                                const headerDiv = document.createElement('div');
                                headerDiv.className = 'message-header';
                                headerDiv.innerHTML = headerHTML;
                                
                                headerDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
                                    copyToClipboard(streamedContent, e.target);
                                });
                                
                                headerDiv.querySelector('.speak-btn').addEventListener('click', async (e) => {
                                    const btn = e.target;
                                    btn.disabled = true;
                                    btn.textContent = 'Speaking...';
                                    try {
                                        await speakText(streamedContent, ttsSpeaker ? ttsSpeaker.value : 'en');
                                    } catch (err) {
                                        console.error('[TTS] Speak button error:', err);
                                    } finally {
                                        btn.disabled = false;
                                        btn.textContent = 'Speak';
                                    }
                                });
                                
                                messageDiv.appendChild(headerDiv);
                                
                                const contentDiv = document.createElement('div');
                                contentDiv.className = 'message-content';
                                contentDiv.innerHTML = renderMarkdown(streamedContent);
                                messageDiv.appendChild(contentDiv);
                                
                                // For conversation mode, speak the response
                                if (conversationMode && streamedContent) {
                                    await speakText(streamedContent, ttsSpeaker.value);
                                }
                            } else if (data.type === 'error') {
                                messageDiv.querySelector('.message-content').innerHTML = `<span class="error">${data.error || 'An error occurred'}</span>`;
                            }
                        } catch (e) {
                            console.error('Error parsing SSE:', e);
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error:', error);
        messageDiv.querySelector('.message-content').innerHTML = '<span class="error">Failed to connect to the server</span>';
    } finally {
        isLoading = false;
        typingIndicator.style.display = 'none';
        checkHealth();
        renderSessionList();
    }
}

// Speak text using TTS with streaming for faster audio start
async function speakText(text, speaker = 'en') {
    if (!text) {
        console.warn('[TTS] speakText called with empty text');
        return;
    }
    
    // Reset stop flag - this function is called from "Speak" button in regular chat
    if (typeof stopAudioRequested !== 'undefined') {
        stopAudioRequested = false;
    }
    
    // Reset crossfade state for new TTS session
    resetCrossfadeState();
    
    console.log('[TTS] speakText called with text length:', text.length, 'speaker:', speaker);
    
    if (conversationMode) {
        micBtn.disabled = true;
        conversationStatus.textContent = '🔊 Speaking...';
    }
    
    // Audio playback queue for streaming
    let audioQueue = [];
    let isPlaying = false;
    let playbackPromise = Promise.resolve(); // Track ongoing playback
    
    async function playNextAudio() {
        if (isPlaying) return; // Already playing
        if (audioQueue.length === 0) return; // Nothing to play
        
        isPlaying = true;
        console.log('[TTS] Starting playback, queue length:', audioQueue.length);
        
        while (audioQueue.length > 0) {
            const { audio, sampleRate } = audioQueue.shift();
            try {
                console.log('[TTS] Playing audio chunk, sample rate:', sampleRate);
                await playTTS(audio, sampleRate);
            } catch (e) {
                console.error('[TTS] Playback error:', e);
            }
        }
        
        isPlaying = false;
        console.log('[TTS] Playback complete');
    }
    
    try {
        console.log('[TTS] Sending streaming request with speaker:', speaker);
        
        // Use streaming TTS endpoint for faster audio start
        const response = await fetch('/api/tts/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, speaker: speaker })
        });
        
        console.log('[TTS] Response status:', response.status);
        
        if (!response.ok) {
            // Fall back to batch TTS
            console.log('[TTS] Streaming not available (' + response.status + '), using batch');
            const batchResponse = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, speaker: speaker })
            });
            
            const data = await batchResponse.json();
            console.log('[TTS] Batch response:', data.success, data.error);
            if (data.success && data.audio) {
                await playTTS(data.audio);
            } else {
                console.error('[TTS] Batch TTS failed:', data.error);
            }
            return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('[TTS] Stream ended');
                break;
            }
            
            buffer += decoder.decode(value, { stream: true });
            
            // Process SSE events
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            
            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.slice(6);
                        if (!dataStr.trim()) continue;
                        
                        try {
                            const data = JSON.parse(dataStr);
                            
                            if (data.type === 'audio') {
                                chunkCount++;
                                // Queue audio chunk
                                audioQueue.push({
                                    audio: data.audio,
                                    sampleRate: data.sample_rate
                                });
                                console.log(`[TTS] Received audio chunk ${chunkCount}, queue: ${audioQueue.length}`);
                                
                                // Start playing immediately
                                playNextAudio();
                            } else if (data.type === 'done') {
                                console.log('[TTS] Streaming complete, chunks:', chunkCount);
                            } else if (data.type === 'error') {
                                console.error('[TTS] Server error:', data.error);
                            }
                        } catch (e) {
                            console.error('[TTS] Parse error:', e, 'data:', dataStr.substring(0, 100));
                        }
                    }
                }
            }
        }
        
        // Wait for all audio to finish playing
        console.log('[TTS] Waiting for playback to complete, queue:', audioQueue.length, 'isPlaying:', isPlaying);
        while (isPlaying || audioQueue.length > 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.log('[TTS] All playback complete');
        
    } catch (error) {
        console.error('[TTS] Error:', error);
        // Try batch TTS as fallback on any error
        try {
            console.log('[TTS] Trying batch TTS as fallback');
            const batchResponse = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, speaker: speaker })
            });
            
            const data = await batchResponse.json();
            if (data.success && data.audio) {
                await playTTS(data.audio);
            }
        } catch (fallbackError) {
            console.error('[TTS] Fallback also failed:', fallbackError);
        }
    } finally {
        if (conversationMode) {
            micBtn.disabled = false;
            conversationStatus.textContent = '🎙️ Voice Mode Active';
        }
    }
}

// Cross-fade state for smooth chunk transitions
let previousChunkEndSamples = null;
let isFirstAudioChunk = true;

// Crossfade configuration - 480 samples = ~10ms at 48kHz for smooth transitions
const CROSSFADE_SAMPLES = 480;

// ============================================================
// WEB AUDIO API PLAYBACK (Lower Latency Alternative)
// ============================================================

// Global AudioContext for Web Audio API playback
let webAudioContext = null;
let webAudioSourceNode = null;
let webAudioPlaying = false;
let webAudioQueue = [];
let webAudioStartTime = 0;
let webAudioNextStartTime = 0;

/**
 * Initialize or get the Web Audio API context
 * This provides lower latency and more control than Audio elements
 */
function getWebAudioContext() {
    if (!webAudioContext) {
        webAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 48000,  // Match server output
            latencyHint: 'interactive'  // Lowest latency
        });
        console.log('[WEB_AUDIO] Initialized AudioContext:', webAudioContext.sampleRate + 'Hz');
    }
    
    // Resume if suspended (required by browsers after user interaction)
    if (webAudioContext.state === 'suspended') {
        webAudioContext.resume();
    }
    
    return webAudioContext;
}

/**
 * Play audio using Web Audio API with precise scheduling
 * @param {Float32Array} audioData - Audio samples as Float32Array (-1 to 1)
 * @param {number} sampleRate - Sample rate of the audio
 * @returns {Promise} Resolves when audio finishes playing
 */
function playWithWebAudio(audioData, sampleRate) {
    return new Promise((resolve) => {
        try {
            const ctx = getWebAudioContext();
            
            // Apply crossfade before scheduling
            const processedData = applyEqualPowerCrossfade(audioData, sampleRate);
            
            // Create buffer for this chunk
            const numSamples = processedData.length;
            const audioBuffer = ctx.createBuffer(1, numSamples, sampleRate);
            const channelData = audioBuffer.getChannelData(0);
            
            // Copy audio data
            channelData.set(processedData);
            
            // Create source node
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            
            // Connect to destination
            source.connect(ctx.destination);
            
            // Handle playback end
            source.onended = () => {
                resolve();
            };
            
            // PRECISE SCHEDULING: Always schedule with AudioContext time
            const currentTime = ctx.currentTime;
            
            // If nothing is playing, start now
            // Otherwise, schedule after the last chunk
            const startTime = Math.max(currentTime, webAudioNextStartTime);
            source.start(startTime);
            
            // Update the time for the next chunk
            const duration = numSamples / sampleRate;
            webAudioNextStartTime = startTime + duration;
            
            console.log(`[WEB_AUDIO] Scheduled ${numSamples} samples at ${startTime.toFixed(3)}s, duration=${duration.toFixed(3)}s, next=${webAudioNextStartTime.toFixed(3)}s`);
            
        } catch (error) {
            console.error('[WEB_AUDIO] Playback error:', error);
            resolve();
        }
    });
}

/**
 * Apply equal-power crossfade for smooth chunk transitions
 * Uses cos/sin curves for constant power during fade
 * CRITICAL FIX: Save ORIGINAL end samples BEFORE crossfade to avoid cumulative distortion
 * @param {Float32Array} audioData - Audio samples
 * @param {number} sampleRate - Sample rate
 * @returns {Float32Array} Processed audio with crossfade applied
 */
function applyEqualPowerCrossfade(audioData, sampleRate) {
    const numSamples = audioData.length;
    const crossfadeLen = Math.min(CROSSFADE_SAMPLES, Math.floor(numSamples / 4));
    
    // Create output buffer
    const output = new Float32Array(numSamples);
    output.set(audioData);
    
    // IMPORTANT: Save ORIGINAL end samples BEFORE any modification
    // This prevents cumulative distortion from crossfading already-crossfaded data
    const originalEndSamples = new Float32Array(crossfadeLen);
    for (let i = 0; i < crossfadeLen; i++) {
        originalEndSamples[i] = audioData[numSamples - crossfadeLen + i];
    }
    
    // Apply fade-in to first chunk to avoid startup click
    if (isFirstAudioChunk) {
        const fadeInLen = Math.min(144, Math.floor(numSamples / 8));
        for (let i = 0; i < fadeInLen; i++) {
            const t = i / fadeInLen;
            // Equal-power fade in
            output[i] = audioData[i] * Math.sin(t * Math.PI / 2);
        }
        isFirstAudioChunk = false;
    }
    
    // Cross-fade start of this chunk with end of previous chunk
    if (previousChunkEndSamples && previousChunkEndSamples.length === crossfadeLen) {
        for (let i = 0; i < crossfadeLen; i++) {
            const t = i / crossfadeLen;
            // Equal-power cross-fade: cos for fade out, sin for fade in
            const fadeOut = Math.cos(t * Math.PI / 2);
            const fadeIn = Math.sin(t * Math.PI / 2);
            // Blend previous chunk end with current chunk start
            output[i] = previousChunkEndSamples[i] * fadeOut + audioData[i] * fadeIn;
        }
    }
    
    // Store ORIGINAL end samples for next chunk (not the modified ones!)
    previousChunkEndSamples = originalEndSamples;
    
    return output;
}

/**
 * Convert Int16 PCM to Float32 for Web Audio API
 * @param {Int16Array} int16Data - PCM data as 16-bit integers
 * @returns {Float32Array} Audio data as floats (-1 to 1)
 */
function int16ToFloat32(int16Data) {
    const float32 = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
        float32[i] = int16Data[i] / 32768.0;
    }
    return float32;
}

/**
 * Reset Web Audio API state for new TTS session
 */
function resetWebAudioState() {
    webAudioNextStartTime = 0;
    webAudioPlaying = false;
    webAudioQueue = [];
}

// Flag to use Web Audio API instead of Audio element
const USE_WEB_AUDIO_API = true;  // Set to true for lower latency

// ============================================================
// SIMPLE AUDIO QUEUE (Like pocket-tts-server)
// ============================================================

// Audio queue for sequential playback - simple, proven approach
let ttsAudioQueue = [];
let ttsIsPlayingQueue = false;
let ttsCurrentAudio = null;

/**
 * Queue audio data and play sequentially
 * @param {string} audioBase64 - Base64 encoded complete WAV file
 */
function queueTTSChunk(audioBase64) {
    if (!audioBase64 || audioBase64.length < 100) {
        console.warn('[TTS-QUEUE] Invalid audio data');
        return;
    }
    
    ttsAudioQueue.push(audioBase64);
    console.log('[TTS-QUEUE] Audio queued, queue length:', ttsAudioQueue.length);
    
    // Start playing if not already
    playTTSQueue();
}

/**
 * Play audio queue sequentially - simple approach from pocket-tts-server
 */
async function playTTSQueue() {
    if (ttsIsPlayingQueue || ttsAudioQueue.length === 0) return;
    
    ttsIsPlayingQueue = true;
    
    while (ttsAudioQueue.length > 0) {
        // Check if stop requested
        if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
            console.log('[TTS-QUEUE] Stop requested, clearing queue');
            ttsAudioQueue = [];
            if (ttsCurrentAudio) {
                ttsCurrentAudio.pause();
                ttsCurrentAudio = null;
            }
            break;
        }
        
        const audioData = ttsAudioQueue.shift();
        
        try {
            // Simple Audio element playback - works reliably
            const audio = new Audio('data:audio/wav;base64,' + audioData);
            ttsCurrentAudio = audio;
            
            await new Promise((resolve, reject) => {
                audio.onended = () => {
                    ttsCurrentAudio = null;
                    resolve();
                };
                audio.onerror = (e) => {
                    console.error('[TTS-QUEUE] Audio error:', e);
                    ttsCurrentAudio = null;
                    resolve(); // Continue anyway
                };
                audio.play().catch(reject);
            });
        } catch (e) {
            console.error('[TTS-QUEUE] Playback error:', e);
        }
    }
    
    ttsIsPlayingQueue = false;
    console.log('[TTS-QUEUE] Playback complete');
}

/**
 * Connect to TTS WebSocket - simple JSON-based protocol
 */
let ttsWebSocket = null;

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
                    queueTTSChunk(msg.data);
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
 * Clear the TTS queue and stop playback
 */
function clearTTSQueue() {
    ttsAudioQueue = [];
    ttsIsPlayingQueue = false;
    if (ttsCurrentAudio) {
        ttsCurrentAudio.pause();
        ttsCurrentAudio = null;
    }
}

/**
 * Stream TTS via WebSocket - simple approach matching pocket-tts-server
 */
async function speakTextViaWebSocket(text, voiceCloneId = null) {
    console.log('[TTS-WS] speakTextViaWebSocket:', text.substring(0, 50));
    
    // Reset state
    ttsAudioQueue = [];
    ttsIsPlayingQueue = false;
    if (ttsCurrentAudio) {
        ttsCurrentAudio.pause();
        ttsCurrentAudio = null;
    }
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
        
        // Wait for all playback
        return new Promise((resolve) => {
            const checkDone = () => {
                if (!ttsIsPlayingQueue && ttsAudioQueue.length === 0) {
                    resolve();
                } else {
                    setTimeout(checkDone, 100);
                }
            };
            checkDone();
        });
        
    } catch (error) {
        console.error('[TTS-WS] Error:', error);
        await speakText(text, voiceCloneId);
    }
}

// Play TTS audio - handles complete WAV files
// Returns a promise that resolves when playback is complete
function playTTS(audioBase64, sampleRate = null) {
    return new Promise((resolve, reject) => {
        try {
            // PHASE 3: GUARD - Only use <audio> playback in WAV mode
            if (window.TTS_PLAYBACK_MODE !== "wav") {
                console.log("[TTS] Skipping WAV playback (WebSocket mode active)");
                resolve();
                return;
            }
            
            // Check if stop was requested (from voice.js)
            if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
                console.log('[TTS] Skipping playback - stop requested');
                resolve();
                return;
            }
            
            // AGGRESSIVE CLEANUP: Stop and remove ALL orphaned audio elements
            const allAudios = [...document.querySelectorAll("audio")];
            console.log('[TTS-DIAG] Before play - Active audio elements:', allAudios.length);
            
            if (allAudios.length > 0) {
                console.log('[TTS-DIAG] Cleaning up', allAudios.length, 'orphaned audio elements');
                allAudios.forEach((audio, i) => {
                    try {
                        if (!audio.paused) {
                            console.log('[TTS-DIAG] Stopping playing audio', i);
                            audio.pause();
                        }
                        if (audio.src && audio.src.startsWith('blob:')) {
                            URL.revokeObjectURL(audio.src);
                        }
                        audio.removeAttribute('src');
                        audio.load(); // Force release
                        // Remove from DOM if attached
                        if (audio.parentNode) {
                            audio.parentNode.removeChild(audio);
                        }
                    } catch (e) {
                        console.warn('[TTS-DIAG] Error cleaning audio', i, e);
                    }
                });
            }
            
            // Clear our reference
            chatCurrentAudio = null;
            
            // Decode base64 to binary
            const binaryString = atob(audioBase64);
            const len = binaryString.length;
            const arrayBuffer = new ArrayBuffer(len);
            const uint8Array = new Uint8Array(arrayBuffer);
            for (let i = 0; i < len; i++) {
                uint8Array[i] = binaryString.charCodeAt(i) & 0xFF;
            }
            
            // Check if it's already a WAV file (starts with "RIFF")
            let blob;
            if (uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 && uint8Array[3] === 0x46) {
                // Already a complete WAV file - play directly
                blob = new Blob([uint8Array], { type: 'audio/wav' });
                console.log('[TTS] Playing complete WAV file, size:', len);
            } else if (sampleRate) {
                // Raw PCM - create WAV container
                const wavBuffer = createWavBuffer(arrayBuffer, sampleRate);
                blob = new Blob([wavBuffer], { type: 'audio/wav' });
                console.log('[TTS] Created WAV container for raw PCM, sample rate:', sampleRate);
            } else {
                // Assume WAV (backward compatibility)
                blob = new Blob([uint8Array], { type: 'audio/wav' });
            }
            
            const audioUrl = URL.createObjectURL(blob);
            
            chatCurrentAudio = new Audio(audioUrl);
            
            // DIAGNOSTIC: Continuous monitoring during playback
            let diagInterval = setInterval(() => {
                const audios = [...document.querySelectorAll("audio")];
                const playing = audios.filter(a => !a.paused);
                if (playing.length > 1) {
                    console.error('[TTS-DIAG] OVERLAP DETECTED! Multiple audio elements playing:', playing.length);
                    playing.forEach((a, i) => {
                        console.error(`[TTS-DIAG]   Audio ${i}: currentTime=${a.currentTime.toFixed(3)}, src=${a.src.substring(0, 30)}...`);
                    });
                }
            }, 100);
            
            // Resolve promise when audio finishes playing
            chatCurrentAudio.onended = () => {
                clearInterval(diagInterval);
                URL.revokeObjectURL(audioUrl);
                if (conversationMode) {
                    micBtn.disabled = false;
                }
                resolve();
            };
            
            chatCurrentAudio.onerror = (e) => {
                URL.revokeObjectURL(audioUrl);
                console.error('[TTS] Playback error:', e);
                if (conversationMode) {
                    micBtn.disabled = false;
                }
                resolve(); // Still resolve to continue queue
            };
            
            chatCurrentAudio.play().then(() => {
                // Audio started successfully
            }).catch((e) => {
                console.error('[TTS] Play error:', e);
                URL.revokeObjectURL(audioUrl);
                resolve(); // Resolve anyway to continue
            });
        } catch (error) {
            console.error('[TTS] Error:', error);
            if (conversationMode) {
                micBtn.disabled = false;
            }
            resolve(); // Resolve to continue queue
        }
    });
}

// Apply crossfade to PCM audio for smooth chunk transitions
// CRITICAL FIX: Save ORIGINAL end samples BEFORE crossfade to avoid cumulative distortion
function applyCrossfade(pcmBuffer, sampleRate) {
    const pcm16 = new Int16Array(pcmBuffer);
    const numSamples = pcm16.length;
    const float32 = new Float32Array(numSamples);
    
    // Convert to float32
    for (let i = 0; i < numSamples; i++) {
        float32[i] = pcm16[i] / 32768.0;
    }
    
    // Use longer crossfade for smoother transitions (reduced metallic artifact)
    const crossFadeLength = Math.min(480, Math.floor(numSamples / 8)); // ~10ms at 48kHz
    const fadeLength = Math.min(144, Math.floor(numSamples / 4)); // ~3ms fade-in
    
    // IMPORTANT: Save ORIGINAL end samples BEFORE any modification
    // This prevents cumulative distortion from crossfading already-crossfaded data
    const originalEndSamples = new Float32Array(crossFadeLength);
    for (let i = 0; i < crossFadeLength; i++) {
        originalEndSamples[i] = float32[numSamples - crossFadeLength + i];
    }
    
    // Apply fade-in to first chunk to avoid startup click
    if (isFirstAudioChunk) {
        for (let i = 0; i < fadeLength; i++) {
            const t = i / fadeLength;
            // Equal-power fade-in for smoother startup
            float32[i] *= Math.sin(t * Math.PI / 2);
        }
        isFirstAudioChunk = false;
    }
    
    // Cross-fade start of this chunk with end of previous chunk
    if (previousChunkEndSamples && previousChunkEndSamples.length === crossFadeLength) {
        for (let i = 0; i < crossFadeLength; i++) {
            const t = i / crossFadeLength;
            // Equal-power cross-fade for smoother transitions
            const fadeIn = Math.sin(t * Math.PI / 2);
            const fadeOut = Math.cos(t * Math.PI / 2);
            float32[i] = previousChunkEndSamples[i] * fadeOut + float32[i] * fadeIn;
        }
    }
    
    // Store ORIGINAL end samples for next chunk (not the modified ones!)
    previousChunkEndSamples = originalEndSamples;
    
    // Convert back to int16 PCM
    const result = new Int16Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        // Clamp to [-1, 1] and convert to 16-bit
        const sample = Math.max(-1, Math.min(1, float32[i]));
        result[i] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    
    return result.buffer;
}

// Reset crossfade state when starting new TTS session
function resetCrossfadeState() {
    previousChunkEndSamples = null;
    isFirstAudioChunk = true;
}

// Create WAV buffer from raw PCM - client-side for low latency
function createWavBuffer(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.byteLength;
    const bufferSize = 44 + dataSize;
    
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    
    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    
    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Copy PCM data
    const pcmView = new Uint8Array(pcmData);
    const offset = 44;
    for (let i = 0; i < pcmView.length; i++) {
        view.setUint8(offset + i, pcmView[i]);
    }
    
    return buffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Log that chat.js is loaded
console.log('[CHAT] chat.js loaded - sendMessage is defined:', typeof sendMessage);
