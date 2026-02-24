/**
 * LM Studio Chatbot - Chat Module
 * Session management and chat functionality
 */

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

// Play TTS audio - handles both WAV and raw PCM with crossfade
// Returns a promise that resolves when playback is complete
function playTTS(audioBase64, sampleRate = null) {
    return new Promise((resolve, reject) => {
        try {
            // Check if stop was requested (from voice.js)
            if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
                console.log('[TTS] Skipping playback - stop requested');
                resolve();
                return;
            }
            
            if (currentAudio) {
                currentAudio.pause();
                currentAudio = null;
            }
            
            let blob;
            let pcmDataForCrossfade = null;
            
            if (sampleRate) {
                // Raw PCM - create WAV container on client for low latency
                // Fix: properly convert base64 to binary (charCodeAt returns wrong values for >127)
                const binaryString = atob(audioBase64);
                const len = binaryString.length;
                const pcmBuffer = new ArrayBuffer(len);
                const pcmView = new Uint8Array(pcmBuffer);
                for (let i = 0; i < len; i++) {
                    pcmView[i] = binaryString.charCodeAt(i) & 0xFF; // Mask to 8 bits
                }
                
                // Store for crossfade
                pcmDataForCrossfade = pcmBuffer;
                
                // Apply crossfade to PCM data for smooth transitions
                const processedPcm = applyCrossfade(pcmBuffer, sampleRate);
                
                // Create WAV header + PCM data
                const wavBuffer = createWavBuffer(processedPcm, sampleRate);
                blob = new Blob([wavBuffer], { type: 'audio/wav' });
            } else {
                // Assume WAV (backward compatibility)
                const binaryString = atob(audioBase64);
                const len = binaryString.length;
                const arrayBuffer = new ArrayBuffer(len);
                const uint8Array = new Uint8Array(arrayBuffer);
                for (let i = 0; i < len; i++) {
                    uint8Array[i] = binaryString.charCodeAt(i) & 0xFF; // Mask to 8 bits
                }
                blob = new Blob([uint8Array], { type: 'audio/wav' });
            }
            
            const audioUrl = URL.createObjectURL(blob);
            
            currentAudio = new Audio(audioUrl);
            
            // IMPORTANT: Resolve promise when audio finishes playing
            // This ensures sequential audio chunks play one after another
            currentAudio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                if (conversationMode) {
                    micBtn.disabled = false;
                }
                resolve(); // Signal that playback is complete
            };
            
            currentAudio.onerror = (e) => {
                URL.revokeObjectURL(audioUrl);
                console.error('TTS playback error:', e);
                if (conversationMode) {
                    micBtn.disabled = false;
                }
                resolve(); // Still resolve to continue queue
            };
            
            currentAudio.play().then(() => {
                // Audio started successfully - the promise will resolve in onended
            }).catch((e) => {
                console.error('TTS play error:', e);
                URL.revokeObjectURL(audioUrl);
                resolve(); // Resolve anyway to continue
            });
        } catch (error) {
            console.error('TTS Error:', error);
            if (conversationMode) {
                micBtn.disabled = false;
            }
            resolve(); // Resolve to continue queue
        }
    });
}

// Apply crossfade to PCM audio for smooth chunk transitions
function applyCrossfade(pcmBuffer, sampleRate) {
    const pcm16 = new Int16Array(pcmBuffer);
    const numSamples = pcm16.length;
    const float32 = new Float32Array(numSamples);
    
    // Convert to float32
    for (let i = 0; i < numSamples; i++) {
        float32[i] = pcm16[i] / 32768.0;
    }
    
    const crossFadeLength = Math.min(32, Math.floor(numSamples / 32)); // ~1.3ms
    const fadeLength = Math.min(64, Math.floor(numSamples / 4)); // ~2.7ms fade-in
    
    // Apply fade-in to first chunk to avoid startup click
    if (isFirstAudioChunk) {
        for (let i = 0; i < fadeLength; i++) {
            const t = i / fadeLength;
            float32[i] *= t; // Linear fade-in
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
    
    // Save end samples for cross-fade with next chunk
    previousChunkEndSamples = new Float32Array(crossFadeLength);
    for (let i = 0; i < crossFadeLength; i++) {
        previousChunkEndSamples[i] = float32[numSamples - crossFadeLength + i];
    }
    
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
