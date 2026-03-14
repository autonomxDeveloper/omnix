/**
 * LM Studio Chatbot - Chat API
 * Handles sending messages and conversation REST API
 */

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Generate a smart title from conversation using LLM
async function generateSmartTitle(userMessage, aiResponse) {
    try {
        const response = await fetch('/api/sessions/generate-title', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_message: userMessage,
                ai_response: aiResponse
            })
        });
        const data = await response.json();
        if (data.success && data.title) {
            return data.title;
        }
    } catch (e) {
        console.error('Error generating title:', e);
    }
    return null;
}

// Send message with streaming support - includes streaming TTS
async function sendMessage() {
    const message = messageInput.value.trim();
    const attachments = window.getAttachments ? window.getAttachments() : [];
    
    if ((!message && attachments.length === 0) || isLoading) return;
    
    welcomeMessage.classList.add('hidden');
    addMessage('user', message, null, null, '', attachments);
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    // Clear attachments after adding to message
    if (window.clearAttachments) {
        window.clearAttachments();
    }
    
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
    if (typeof window.TTSQueue?.clearAudioQueue === 'function') {
        window.TTSQueue.clearAudioQueue();
    }
    
    // Create placeholder AI message for streaming
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai';
    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-label">AI</span>
            <span class="tts-playing" style="display: none;">🔊 Speaking...</span>
            <button class="speak-btn" title="Speak">Speak</button>
            <button class="pause-btn" title="Pause" style="display: none;">⏸</button>
            <button class="stop-btn" title="Stop" style="display: none;">⏹</button>
            <button class="copy-btn" title="Copy">Copy</button>
        </div>
        <div class="message-content streaming"></div>
    `;
    messagesContainer.appendChild(messageDiv);
    
    let streamedContent = '';
    let thinkingContent = '';
    let audioChunkCount = 0;
    let directModeDone = false; // Track if we've already processed done event
    let firstTokenTime = null; // Track TTFT for direct mode
    
    // Use voice-stream endpoint for streaming TTS only in conversation mode
    // In regular chat mode, user must click "Speak" button to hear audio
    const useStreamingTTS = false; // Disabled for regular chat - user clicks Speak instead
    
    // Check if LMStudio direct mode is enabled
    const lmstudioDirectInput = document.getElementById('lmstudioDirect');
    const useDirectMode = lmstudioDirectInput && lmstudioDirectInput.checked;
    const lmstudioUrlInput = document.getElementById('lmstudioUrl');
    const lmstudioBaseUrl = lmstudioUrlInput ? lmstudioUrlInput.value : 'http://localhost:1234';
    
    const endpoint = useDirectMode ? `${lmstudioBaseUrl}/v1/chat/completions` : '/api/chat/stream';
    
    try {
        // Get the system prompt - use global + voice personality without duplication
        let systemPrompt = systemPromptInput?.value || 'You are a helpful AI assistant.';
        
        // If a voice/speaker is selected and has a personality profile, append it
        const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
        if (ttsSpeakerSelect && ttsSpeakerSelect.value && window.features) {
            const voiceId = ttsSpeakerSelect.value;
            const voiceProfile = window.features.getVoiceProfile(voiceId);
            if (voiceProfile && voiceProfile.personality) {
                // Only append if not already included in global prompt
                if (!systemPrompt.includes(voiceProfile.name)) {
                    systemPrompt = `${systemPrompt}\n\n## Current Character: ${voiceProfile.name || voiceId}\n${voiceProfile.personality}`;
                }
                console.log(`[CHAT] Using personality for voice: ${voiceProfile.name}`);
            }
        }
        
        // Process attachments - convert images to base64 for vision models
        let processedAttachments = [];
        if (attachments && attachments.length > 0) {
            for (const file of attachments) {
                if (file.type.startsWith('image/')) {
                    const base64 = await fileToBase64(file);
                    processedAttachments.push({
                        type: 'image',
                        name: file.name,
                        mimeType: file.type,
                        data: base64
                    });
                } else {
                    processedAttachments.push({
                        type: 'document',
                        name: file.name,
                        mimeType: file.type
                    });
                }
            }
        }

        const requestBody = {
            message: message,
            session_id: SessionManager.sessionId,
            model: modelSelect.value,
            system_prompt: systemPrompt,
            attachments: processedAttachments
        };
        
        // Add speaker for voice-stream endpoint
        // Always add speaker to request, regardless of streaming mode
        if (ttsSpeakerSelect && ttsSpeakerSelect.value) {
            requestBody.speaker = ttsSpeakerSelect.value;
            console.log('[CHAT] Speaker added to request:', requestBody.speaker);
        } else {
            console.log('[CHAT] No speaker selected or ttsSpeakerSelect not found');
        }
        
        console.log('[CHAT] Final requestBody:', JSON.stringify(requestBody, null, 2));
        console.log('[CHAT] Attachments being sent:', processedAttachments.length);
        
        // For direct LMStudio mode, convert to OpenAI format
        let fetchBody;
        let isDirectLMStudio = useDirectMode;
        
        if (useDirectMode) {
            // Build messages array in OpenAI format
            const messages = [];
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            
            // Handle vision content for direct mode
            const imageAttachments = processedAttachments.filter(a => a.type === 'image');
            if (imageAttachments.length > 0) {
                // Build multi-modal content for vision models
                const contentParts = [];
                if (message) {
                    contentParts.push({ type: 'text', text: message });
                }
                for (const img of imageAttachments) {
                    contentParts.push({
                        type: 'image_url',
                        image_url: { url: img.data }
                    });
                }
                messages.push({ role: 'user', content: contentParts });
            } else {
                messages.push({ role: 'user', content: message });
            }
            
            fetchBody = JSON.stringify({
                model: modelSelect.value,
                messages: messages,
                stream: true
            });
        } else {
            fetchBody = JSON.stringify(requestBody);
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: fetchBody
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
                        
                        // Check for [DONE] marker (OpenAI/LMStudio format)
                        if (dataStr === '[DONE]') {
                            // Signal done for direct LMStudio mode (only once)
                            if (isDirectLMStudio && !directModeDone) {
                                directModeDone = true;
                                console.log('[TOKEN] Done event received (direct mode). streamedContent length:', streamedContent?.length);
                                const generationTimeMs = startTime ? (Date.now() - startTime) : null;
                                const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
                                const tokenSpeed = generationTimeMs > 0 && tokensGenerated > 0 
                                    ? (tokensGenerated / (generationTimeMs / 1000)) 
                                    : 0;
                                
                                if (typeof window.updateTokenCounterFromText === 'function') {
                                    window.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                } else if (window.features && typeof window.features.updateTokenCounterFromText === 'function') {
                                    window.features.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                }
                                
                                if (typeof window.updateTimingSummary === 'function') {
                                    window.updateTimingSummary({
                                        requestStart: startTime || performance.now(),
                                        total: generationTimeMs || 0,
                                        llm: firstTokenTime || generationTimeMs || 0,
                                        llmDone: generationTimeMs || 0,
                                        tts: 0,
                                        audioPlayStart: generationTimeMs || 0,
                                        tokens: tokensGenerated,
                                        tokensPerSecond: tokenSpeed
                                    });
                                }
                                
                                // Rebuild message with proper structure
                                messageDiv.innerHTML = '';
                                let headerHTML = `<span class="message-label">AI</span>`;
                                headerHTML += `<button class="speak-btn" title="Speak">Speak</button>`;
                                headerHTML += `<button class="pause-btn" title="Pause" style="display: none;">⏸</button>`;
                                headerHTML += `<button class="stop-btn" title="Stop" style="display: none;">⏹</button>`;
                                headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
                                
                                const contentDiv = document.createElement('div');
                                contentDiv.className = 'message-content';
                                contentDiv.textContent = streamedContent;
                                
                                messageDiv.innerHTML = `<div class="message-header">${headerHTML}</div>`;
                                messageDiv.appendChild(contentDiv);
                                
                                // Setup buttons manually
                                messageDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
                                    copyToClipboard(streamedContent, e.target);
                                });
                                
                                messageDiv.querySelector('.stop-btn').addEventListener('click', (e) => {
                                    fetch('/api/tts/stream/cancel', { method: 'POST' }).catch(() => {});
                                    if (typeof stopAudio === 'function') stopAudio();
                                    if (typeof window.stopTTSAudio === 'function') window.stopTTSAudio();
                                    if (typeof stopTTSPlayback === 'function') stopTTSPlayback();
                                    if (typeof window.TTSQueue?.stop === 'function') window.TTSQueue.stop();
                                    const stopBtn = e.target;
                                    stopBtn.style.display = 'none';
                                    const speakBtn = messageDiv.querySelector('.speak-btn');
                                    if (speakBtn) speakBtn.style.display = 'inline-flex';
                                });
                                
                                messageDiv.querySelector('.speak-btn').addEventListener('click', async (e) => {
                                    const btn = e.target;
                                    currentMessageDiv = messageDiv;
                                    
                                    // If paused, resume. Otherwise start fresh
                                    if (isPaused) {
                                        isPaused = false;
                                        playQueuedAudio();
                                        btn.disabled = true;
                                        btn.textContent = 'Speaking...';
                                        const stopBtn = messageDiv.querySelector('.stop-btn');
                                        const pauseBtn = messageDiv.querySelector('.pause-btn');
                                        if (stopBtn) stopBtn.style.display = 'inline-flex';
                                        if (pauseBtn) pauseBtn.style.display = 'inline-flex';
                                        btn.style.display = 'none';
                                        return;
                                    }
                                    
                                    btn.disabled = true;
                                    btn.textContent = 'Speaking...';
                                    btn.style.display = 'none';
                                    const stopBtn = messageDiv.querySelector('.stop-btn');
                                    const pauseBtn = messageDiv.querySelector('.pause-btn');
                                    if (stopBtn) stopBtn.style.display = 'inline-flex';
                                    if (pauseBtn) pauseBtn.style.display = 'inline-flex';
                                    
                                    try {
                                        const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
                                        await speakText(streamedContent, ttsSpeakerSelect ? ttsSpeakerSelect.value : 'en');
                                    } catch (err) {
                                        console.error('[TTS] Speak button error:', err);
                                    }
                                });
                                
                                scrollToBottom();
                            }
                            continue;
                        }
                        
                        try {
                            const data = JSON.parse(dataStr);
                            
                            // Handle direct LMStudio/OpenAI format
                            if (isDirectLMStudio && data.choices && data.choices[0]) {
                                const delta = data.choices[0].delta;
                                if (delta && delta.content) {
                                    // Track TTFT - time when first token arrives
                                    if (firstTokenTime === null) {
                                        firstTokenTime = Date.now() - startTime;
                                        console.log('[TOKEN] TTFT:', firstTokenTime, 'ms');
                                    }
                                    
                                    streamedContent += delta.content;
                                    
                                    const contentEl = messageDiv.querySelector('.message-content');
                                    if (contentEl) {
                                        contentEl.textContent = streamedContent;
                                    } else {
                                        // Create content element if it doesn't exist
                                        messageDiv.innerHTML = `
                                            <div class="message-header">
                                                <span class="message-label">AI</span>
                                                <button class="speak-btn" title="Speak">Speak</button>
                                                <button class="copy-btn" title="Copy">Copy</button>
                                            </div>
                                            <div class="message-content">${streamedContent}</div>
                                        `;
                                    }
                                    scrollToBottom();
                                }
                                
                                // Check for finish_reason (only once)
                                if (!directModeDone && data.choices[0].finish_reason === 'stop') {
                                    directModeDone = true;
                                    console.log('[TOKEN] Done event received (direct mode finish). streamedContent length:', streamedContent?.length);
                                    const generationTimeMs = startTime ? (Date.now() - startTime) : null;
                                    const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
                                    const tokenSpeed = generationTimeMs > 0 && tokensGenerated > 0 
                                        ? (tokensGenerated / (generationTimeMs / 1000)) 
                                        : 0;
                                    
                                    if (typeof window.updateTokenCounterFromText === 'function') {
                                        window.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                    } else if (window.features && typeof window.features.updateTokenCounterFromText === 'function') {
                                        window.features.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                    }
                                    
                                    if (typeof window.updateTimingSummary === 'function') {
                                        window.updateTimingSummary({
                                            requestStart: startTime || performance.now(),
                                            total: generationTimeMs || 0,
                                            llm: firstTokenTime || generationTimeMs || 0,
                                            llmDone: generationTimeMs || 0,
                                            tts: 0,
                                            audioPlayStart: generationTimeMs || 0,
                                            tokens: tokensGenerated,
                                            tokensPerSecond: tokenSpeed
                                        });
                                    }
                                    
                                    // Rebuild message with proper structure
                                    messageDiv.innerHTML = '';
                                    let headerHTML = `<span class="message-label">AI</span>`;
                                    headerHTML += `<button class="speak-btn" title="Speak">Speak</button>`;
                                    headerHTML += `<button class="pause-btn" title="Pause" style="display: none;">⏸</button>`;
                                    headerHTML += `<button class="stop-btn" title="Stop" style="display: none;">⏹</button>`;
                                    headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
                                    
                                    const contentDiv = document.createElement('div');
                                    contentDiv.className = 'message-content';
                                    contentDiv.textContent = streamedContent;
                                    
                                    messageDiv.innerHTML = `<div class="message-header">${headerHTML}</div>`;
                                    messageDiv.appendChild(contentDiv);
                                    
                                    // Setup buttons manually
                                    messageDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
                                        copyToClipboard(streamedContent, e.target);
                                    });
                                    
                                messageDiv.querySelector('.stop-btn').addEventListener('click', (e) => {
                                    fetch('/api/tts/stream/cancel', { method: 'POST' }).catch(() => {});
                                    if (typeof stopAudio === 'function') stopAudio();
                                    if (typeof window.stopTTSAudio === 'function') window.stopTTSAudio();
                                    if (typeof stopTTSPlayback === 'function') stopTTSPlayback();
                                    if (typeof window.TTSQueue?.stop === 'function') window.TTSQueue.stop();
                                    isPaused = false;
                                    const stopBtn = e.target;
                                    stopBtn.style.display = 'none';
                                    const pauseBtn = messageDiv.querySelector('.pause-btn');
                                    if (pauseBtn) pauseBtn.style.display = 'none';
                                    const speakBtn = messageDiv.querySelector('.speak-btn');
                                    if (speakBtn) {
                                        speakBtn.style.display = 'inline-flex';
                                        speakBtn.disabled = false;
                                        speakBtn.textContent = 'Speak';
                                    }
                                });
                                    
                                    messageDiv.querySelector('.speak-btn').addEventListener('click', async (e) => {
                                        const btn = e.target;
                                        currentMessageDiv = messageDiv;
                                        
                                        btn.disabled = true;
                                        btn.textContent = 'Speaking...';
                                        const stopBtn = messageDiv.querySelector('.stop-btn');
                                        if (stopBtn) stopBtn.style.display = 'inline-flex';
                                        try {
                                            const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
                                            await speakText(streamedContent, ttsSpeakerSelect ? ttsSpeakerSelect.value : 'en');
                                        } catch (err) {
                                            console.error('[TTS] Speak button error:', err);
                                        } finally {
                                            btn.disabled = false;
                                            btn.textContent = 'Speak';
                                            if (stopBtn) stopBtn.style.display = 'none';
                                        }
                                    });
                                    
                                    scrollToBottom();
                                }
                                continue;
                            }
                            
                            // Handle server format
                            if (data.type === 'content') {
                                streamedContent += data.content;
                                
                                // Display immediately using textContent - no HTML escaping needed
                                const contentEl = messageDiv.querySelector('.message-content');
                                contentEl.textContent = streamedContent;
                                scrollToBottom();
                            } else if (data.type === 'audio') {
                                // Queue audio chunk for sequential playback
                                if (window.TTSQueue?.enqueueAudio) {
                                    window.TTSQueue.enqueueAudio(data.audio, data.sample_rate);
                                }
                                audioChunkCount++;
                                
                                // Show speaking indicator
                                const ttsIndicator = messageDiv.querySelector('.tts-playing');
                                if (ttsIndicator) ttsIndicator.style.display = 'inline-flex';
                                
                                // Start playing if not already
                                if (typeof window.TTSQueue?.playNextAudio === 'function') {
                                    window.TTSQueue.playNextAudio();
                                }
                            } else if (data.type === 'done') {
                                console.log('[TOKEN] Done event received. streamedContent length:', streamedContent?.length);
                                // Use thinking from server if available, otherwise extract from content
                                if (data.thinking) {
                                    thinkingContent = data.thinking;
                                } else {
                                    const { thinking, content } = extractThinkingFromContent(streamedContent);
                                    thinkingContent = thinking;
                                    streamedContent = content;
                                }
                                
                                const generationTimeMs = startTime ? (Date.now() - startTime) : null;
                                console.log('[TOKEN] Updating tokens, time:', generationTimeMs, 'user:', message?.length, 'ai:', streamedContent?.length);
                                
                                try {
                                    if (typeof window.updateTokenCounterFromText === 'function') {
                                        window.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                    } else if (window.features && typeof window.features.updateTokenCounterFromText === 'function') {
                                        window.features.updateTokenCounterFromText(message, streamedContent, generationTimeMs);
                                    } else {
                                        console.warn('[TOKEN] updateTokenCounterFromText not found!');
                                    }
                                } catch (e) {
                                    console.error('[TOKEN] Error calling updateTokenCounterFromText:', e);
                                }
                                
                                const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
                                const tokenSpeed = generationTimeMs > 0 && tokensGenerated > 0 
                                    ? (tokensGenerated / (generationTimeMs / 1000)) 
                                    : 0;
                                
                                if (typeof window.updateTimingSummary === 'function') {
                                    window.updateTimingSummary({
                                        requestStart: startTime || performance.now(),
                                        total: generationTimeMs || 0,
                                        llm: generationTimeMs ? generationTimeMs * 0.6 : 0,
                                        llmDone: generationTimeMs ? generationTimeMs * 0.8 : 0,
                                        tts: generationTimeMs ? generationTimeMs * 0.4 : 0,
                                        audioPlayStart: generationTimeMs ? generationTimeMs * 0.9 : 0,
                                        tokens: tokensGenerated,
                                        tokensPerSecond: tokenSpeed
                                    });
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
                                headerHTML += `<button class="pause-btn" title="Pause" style="display: none;">⏸</button>`;
                                headerHTML += `<button class="stop-btn" title="Stop" style="display: none;">⏹</button>`;
                                headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
                                
                                const headerDiv = document.createElement('div');
                                headerDiv.className = 'message-header';
                                headerDiv.innerHTML = headerHTML;
                                
                                headerDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
                                    copyToClipboard(streamedContent, e.target);
                                });
                                
                                headerDiv.querySelector('.stop-btn').addEventListener('click', (e) => {
                                    fetch('/api/tts/stream/cancel', { method: 'POST' }).catch(() => {});
                                    if (typeof stopAudio === 'function') stopAudio();
                                    if (typeof window.stopTTSAudio === 'function') window.stopTTSAudio();
                                    if (typeof stopTTSPlayback === 'function') stopTTSPlayback();
                                    if (typeof window.TTSQueue?.stop === 'function') window.TTSQueue.stop();
                                    const stopBtn = e.target;
                                    stopBtn.style.display = 'none';
                                    const speakBtn = messageDiv.querySelector('.speak-btn');
                                    if (speakBtn) speakBtn.style.display = 'inline-flex';
                                });
                                
                                headerDiv.querySelector('.speak-btn').addEventListener('click', async (e) => {
                                    const btn = e.target;
                                    currentMessageDiv = messageDiv;
                                    
                                    btn.disabled = true;
                                    btn.textContent = 'Speaking...';
                                    const stopBtn = messageDiv.querySelector('.stop-btn');
                                    if (stopBtn) stopBtn.style.display = 'inline-flex';
                                    try {
                                        const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
                                        await speakText(streamedContent, ttsSpeakerSelect ? ttsSpeakerSelect.value : 'en');
                                    } catch (err) {
                                        console.error('[TTS] Speak button error:', err);
                                    } finally {
                                        btn.disabled = false;
                                        btn.textContent = 'Speak';
                                        if (stopBtn) stopBtn.style.display = 'none';
                                    }
                                });
                                
                                messageDiv.appendChild(headerDiv);
                                
                                const contentDiv = document.createElement('div');
                                contentDiv.className = 'message-content';
                                contentDiv.innerHTML = renderMarkdown(streamedContent);
                                messageDiv.appendChild(contentDiv);
                                
                                // For conversation mode, speak the response
                                if (conversationMode && streamedContent) {
                                    // Get the selected speaker from the dropdown
                                    const speakerSelect = document.getElementById('ttsSpeaker');
                                    const selectedSpeaker = speakerSelect ? speakerSelect.value : 'en';
                                    await speakText(streamedContent, selectedSpeaker);
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
        
        // Generate smart title if this is a new session
        if (window.SessionManager && message && streamedContent) {
            const currentSession = window.sessions?.find(s => s.id === window.sessionId);
            if (currentSession && (currentSession.title === 'New Chat' || !currentSession.title)) {
                const smartTitle = await generateSmartTitle(message, streamedContent);
                if (smartTitle) {
                    SessionManager.updateSessionTitle(window.sessionId, smartTitle);
                }
            }
        }
        
        SessionManager.renderSessionList();
    }
}

// Speak text using TTS with streaming for faster audio start
async function speakText(text, speaker = 'en') {
    console.log('[TTS-SPEAK] === STARTING SPEAK FUNCTION ===');
    console.log('[TTS-SPEAK] Text length:', text.length);
    console.log('[TTS-SPEAK] Speaker:', speaker);
    console.log('[TTS-SPEAK] Conversation mode:', conversationMode);
    
    if (!text) {
        console.warn('[TTS-SPEAK] speakText called with empty text');
        return;
    }
    
    // Reset stop flag - this function is called from "Speak" button in regular chat
    if (typeof stopAudioRequested !== 'undefined') {
        stopAudioRequested = false;
        console.log('[TTS-SPEAK] Reset stopAudioRequested flag');
    }
    
    // Reset crossfade state for new TTS session
    if (typeof resetCrossfadeState === 'function') {
        resetCrossfadeState();
    }
    console.log('[TTS-SPEAK] Crossfade state reset');
    
    if (conversationMode) {
        micBtn.disabled = true;
        conversationStatus.textContent = '🔊 Speaking...';
        console.log('[TTS-SPEAK] Disabled mic button for conversation mode');
    }
    
    try {
        console.log('[TTS] Using SSE streaming endpoint with speaker:', speaker);
        
        // Use the new SSE streaming endpoint by default
        await speakTextStreaming(text, speaker);
        
    } catch (error) {
        console.error('[TTS] SSE streaming failed:', error);
        
        // Fallback to batch TTS
        try {
            console.log('[TTS] Trying batch TTS as fallback');
            const batchResponse = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, speaker: speaker })
            });
            
            const data = await batchResponse.json();
            if (data.success && data.audio) {
                if (typeof window.AudioPlayer?.playTTS === 'function') {
                    await window.AudioPlayer.playTTS(data.audio);
                }
            } else {
                console.error('[TTS] Batch TTS failed:', data.error);
            }
        } catch (batchError) {
            console.error('[TTS] Fallback also failed:', batchError);
        }
    } finally {
        if (conversationMode) {
            micBtn.disabled = false;
            conversationStatus.textContent = '🎙️ Voice Mode Active';
        }
    }
}

// Global variables for streaming TTS
let currentStreamController = null;
let audioQueue = [];
let isPlaying = false;
let currentAudioSource = null;
let isPaused = false;
let currentMessageDiv = null;
let isFetching = false; // Prevent multiple simultaneous fetches

// Called when all audio is done playing
function onAudioPlaybackComplete() {
    isPlaying = false;
    isPaused = false;

    if (currentMessageDiv) {
        const speakBtn = currentMessageDiv.querySelector('.speak-btn');
        const stopBtn = currentMessageDiv.querySelector('.stop-btn');
        const pauseBtn = currentMessageDiv.querySelector('.pause-btn');

        if (speakBtn) {
            speakBtn.style.display = 'inline-flex';
            speakBtn.disabled = false;
            speakBtn.textContent = 'Speak';
        }

        if (stopBtn) stopBtn.style.display = 'none';
        if (pauseBtn) pauseBtn.style.display = 'none';
    }
}

function base64ToFloat32(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

function scheduleChunk(float32Array, sampleRate) {
  const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || 
                   (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null) ||
                   new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
  
  const buffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
  buffer.copyToChannel(float32Array, 0);
  audioQueue.push(buffer);
}

function playQueuedAudio() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    currentAudioSource = null;
    onAudioPlaybackComplete();
    return;
  }
  
  // Ensure AudioContext is resumed (needed after pause)
  ensureAudioContext();
  
  // Only play if not already playing and not paused
  if (!isPlaying && !isPaused) {
    isPlaying = true;
    const buffer = audioQueue.shift();
    
    const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || 
                     (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null) ||
                     new (window.AudioContext || window.webkitAudioContext)();
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    
    currentAudioSource = source;
    
    source.onended = () => {
      isPlaying = false;  // Reset before calling playQueuedAudio
      currentAudioSource = null;
      if (!isPaused) {
        playQueuedAudio();
      }
    };
    
    source.start();
  }
}

// Stop TTS audio playback
function stopTTSAudio() {
  // Cancel SSE streaming
  if (currentStreamController) {
      currentStreamController.abort();
      currentStreamController = null;
  }

  // Stop current audio source
  if (currentAudioSource) {
    try {
      currentAudioSource.stop();
      currentAudioSource = null;
    } catch (e) {}
  }
  
  // Clear audio queue
  audioQueue = [];
  
  isPlaying = false;
  isPaused = false;
  isFetching = false;
}

// Pause TTS audio playback
function pauseTTSAudio() {
  // Only suspend AudioContext - don't destroy the source
  try {
    const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || 
                     (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null);
    if (audioCtx && audioCtx.state === 'running') {
      audioCtx.suspend();
    }
  } catch (e) {}

  isPaused = true;
  isPlaying = false;
}

// Expose functions globally
window.stopTTSAudio = stopTTSAudio;
window.pauseTTSAudio = pauseTTSAudio;

// Ensure AudioContext is resumed before playing
function ensureAudioContext() {
  try {
    const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || 
                     (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null);
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch (e) {}
}

// Test function for TTS controls
window.testTTSControls = function() {
    console.log('=== TTS CONTROLS TEST ===');
    console.log('Current state:');
    console.log('- isPlaying:', isPlaying);
    console.log('- isPaused:', isPaused);
    console.log('- audioQueue length:', audioQueue.length);
    console.log('- currentAudioSource:', currentAudioSource ? 'exists' : 'null');
    
    // Test stop
    console.log('\n--- Testing stop ---');
    stopTTSAudio();
    console.log('After stop:');
    console.log('- isPlaying:', isPlaying);
    console.log('- isPaused:', isPaused);
    console.log('- audioQueue length:', audioQueue.length);
    
    // Test pause
    console.log('\n--- Testing pause ---');
    pauseTTSAudio();
    console.log('After pause:');
    console.log('- isPlaying:', isPlaying);
    console.log('- isPaused:', isPaused);
    
    // Test ensureAudioContext
    console.log('\n--- Testing ensureAudioContext ---');
    ensureAudioContext();
    console.log('After ensureAudioContext');
    
    console.log('\n=== TEST COMPLETE ===');
    return { isPlaying, isPaused, audioQueueLength: audioQueue.length };
};

// SSE streaming TTS implementation
async function speakTextStreaming(text, speaker = 'en') {
  // HARD RESET - stop any existing playback first
  stopTTSAudio();
  audioQueue = [];
  isPlaying = false;
  isPaused = false;
  
  // Prevent multiple fetches
  if (isFetching) {
    console.log('[TTS] Already fetching, ignoring');
    return;
  }
  
  // If we have audio in queue and not paused, just play
  if (audioQueue.length > 0 && !isPaused) {
      ensureAudioContext();
      playQueuedAudio();
      return;
  }
  
  // If paused, resume
  if (isPaused && audioQueue.length > 0) {
      isPaused = false;
      ensureAudioContext();
      playQueuedAudio();
      return;
  }
  
  isFetching = true;
  
  return new Promise((resolve, reject) => {
    // Cancel any existing stream
    if (currentStreamController) {
      currentStreamController.abort();
      currentStreamController = null;
    }
    
    // Reset state for fresh play
    currentStreamController = new AbortController();
    const formData = new FormData();
    formData.append('text', text);
    formData.append('speaker', speaker || 'default');
    formData.append('language', 'en');
    
    // Expose abort function for stop button
    window.currentStreamAbort = () => {
      if (currentStreamController) {
        currentStreamController.abort();
      }
    };
    
    fetch('/api/tts/stream/server-sent-events', {
      method: 'POST',
      body: formData,
      signal: currentStreamController.signal
    })
    .then(async response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        // Check if stop was requested
        if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
          console.log('[TTS] Stop requested, aborting stream');
          reader.cancel();
          currentStreamController.abort();
          resolve();
          return;
        }
        
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // incomplete line
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'chunk') {
                const float32 = base64ToFloat32(data.audio_b64);
                scheduleChunk(float32, data.sample_rate);
                if (!isPlaying) {
                  playQueuedAudio();
                }
              } else if (data.type === 'queued') {
                console.log(`[TTS] Queue position: ${data.position}`);
                // Update UI: show "Waiting: ${data.position} ahead"
              } else if (data.type === 'done') {
                console.log('[TTS] TTS streaming completed');
                reader.cancel();
                resolve();
                return;
              } else if (data.type === 'error') {
                console.error('[TTS] Error:', data.message);
                reject(new Error(data.message));
              }
            } catch (e) {
              console.error('[TTS] Parse error:', e);
            }
          }
        }
      }
    })
    .catch(err => {
      if (err.name === 'AbortError') {
        console.log('[TTS] Stream aborted');
      } else {
        console.error('[TTS] Stream error:', err);
        reject(err);
      }
    })
    .finally(() => {
      currentStreamController = null;
      isFetching = false;
    });
  });
}

// Legacy streaming TTS implementation (fallback)
async function speakTextLegacy(text, speaker = 'en') {
  return new Promise((resolve, reject) => {
    // Audio playback queue for streaming
    let audioQueue = [];
    let isPlaying = false;
    
    async function playNextAudio() {
      if (isPlaying) return; // Already playing
      if (audioQueue.length === 0) return; // Nothing to play
      
      isPlaying = true;
      console.log('[TTS] Starting playback, queue length:', audioQueue.length);
      
      while (audioQueue.length > 0) {
        const { audio, sampleRate } = audioQueue.shift();
        try {
          console.log('[TTS] Playing audio chunk, sample rate:', sampleRate);
          if (typeof window.AudioPlayer?.playTTS === 'function') {
            await window.AudioPlayer.playTTS(audio, sampleRate);
          }
        } catch (e) {
          console.error('[TTS] Playback error:', e);
        }
      }
      
      isPlaying = false;
      console.log('[TTS] Playback complete');
    }
    
    fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, speaker: speaker })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const reader = response.body.getReader();
      let totalDataReceived = 0;
      
      return new Promise((resolveLegacy, rejectLegacy) => {
        function processStream() {
          reader.read().then(({ done, value }) => {
            if (done) {
              console.log('[TTS] Stream ended, total data received:', totalDataReceived, 'bytes');
              resolveLegacy();
              return;
            }
            
            totalDataReceived += value.length;
            console.log(`[TTS] Received chunk: ${value.length} bytes`);
            
            // Convert the binary data to base64 for playback
            let binary = '';
            for (let i = 0; i < value.length; i++) {
              binary += String.fromCharCode(value[i]);
            }
            const base64Audio = btoa(binary);
            
            // Use the original sample rate of 24000 Hz
            const detectedSampleRate = 24000;
            
            // Queue audio chunk
            audioQueue.push({
              audio: base64Audio,
              sampleRate: detectedSampleRate
            });
            console.log(`[TTS] Received audio chunk, queue: ${audioQueue.length}, sample rate: ${detectedSampleRate} Hz`);
            
            // Start playing immediately
            playNextAudio();
            
            // Continue processing
            processStream();
          }).catch(rejectLegacy);
        }
        
        processStream();
      });
    })
    .then(() => {
      // Wait for all audio to finish playing
      console.log('[TTS] Waiting for playback to complete, queue:', audioQueue.length, 'isPlaying:', isPlaying);
      return new Promise(resolveWait => {
        const checkComplete = () => {
          if (isPlaying || audioQueue.length > 0) {
            setTimeout(checkComplete, 100);
          } else {
            resolveWait();
          }
        };
        checkComplete();
      });
    })
    .then(() => {
      console.log('[TTS] All playback complete');
      resolve();
    })
    .catch(error => {
      console.error('[TTS] Error:', error);
      reject(error);
    });
  });
}

// Clear chat
async function clearChat() {
    messagesContainer.innerHTML = '';
    welcomeMessage.classList.remove('hidden');
    
    try {
        await fetch('/api/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: SessionManager.sessionId })
        });
    } catch (error) {
        console.error('Error clearing session:', error);
    }
    
    messageInput.focus();
}

// Load system prompt
async function loadSystemPrompt() {
    if (!SessionManager.sessionId) return;
    
    try {
        const response = await fetch(`/api/sessions/${SessionManager.sessionId}`);
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
        await fetch(`/api/sessions/${SessionManager.sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                system_prompt: systemPromptInput.value,
                global_system_prompt: globalSystemPromptInput?.value || ''
            })
        });
    } catch (error) {
        console.error('Error saving system prompt:', error);
    }
}

// Export for use in other modules
window.ChatAPI = {
    sendMessage,
    speakText,
    speakTextStreaming,
    speakTextLegacy,
    clearChat,
    loadSystemPrompt,
    saveSystemPromptHandler
};

// Global pause button handler using event delegation
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('pause-btn')) {
        let messageDiv = e.target.closest('.message');
        if (!messageDiv) messageDiv = e.target.closest('.message-header')?.closest('.message');
        
        // Pause audio
        if (typeof window.pauseTTSAudio === 'function') {
            window.pauseTTSAudio();
        }
        
        // Hide pause, show speak and keep stop visible
        if (messageDiv) {
            const pauseBtn = messageDiv.querySelector('.pause-btn');
            const stopBtn = messageDiv.querySelector('.stop-btn');
            const speakBtn = messageDiv.querySelector('.speak-btn');
            if (pauseBtn) pauseBtn.style.display = 'none';
            // Keep stop button visible - user should still be able to stop
            if (stopBtn) stopBtn.style.display = 'inline-flex';
            if (speakBtn) {
                speakBtn.style.display = 'inline-flex';
                speakBtn.disabled = false;
                speakBtn.textContent = 'Speak';
            }
        }
    }
});