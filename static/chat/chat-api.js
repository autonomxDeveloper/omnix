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
            body: JSON.stringify({ user_message: userMessage, ai_response: aiResponse })
        });
        const data = await response.json();
        if (data.success && data.title) return data.title;
    } catch (e) {
        console.error('Error generating title:', e);
    }
    return null;
}

// Send message with streaming support - includes streaming TTS
async function sendMessage() {
    const message = messageInput.value.trim();
    const attachments = window.getAttachments ? window.getAttachments() :[];
    
    if ((!message && attachments.length === 0) || isLoading) return;
    
    welcomeMessage.classList.add('hidden');
    addMessage('user', message, null, null, '', attachments);
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    if (window.clearAttachments) window.clearAttachments();
    
    isLoading = true;
    statusDot.className = 'status-dot loading';
    statusText.textContent = 'Thinking...';
    typingIndicator.style.display = 'flex';
    
    const startTime = Date.now();
    if (window.features?.startTokenRateTracking) window.features.startTokenRateTracking();
    if (typeof window.TTSQueue?.clearAudioQueue === 'function') window.TTSQueue.clearAudioQueue();
    
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
    let directModeDone = false;
    let firstTokenTime = null;
    
    const useDirectMode = document.getElementById('lmstudioDirect')?.checked;
    const lmstudioBaseUrl = document.getElementById('lmstudioUrl')?.value || 'http://localhost:1234';
    const endpoint = useDirectMode ? `${lmstudioBaseUrl}/v1/chat/completions` : '/api/chat/stream';
    let isDirectLMStudio = useDirectMode;
    
    // Extracted chunk handler for less code duplication
    const handleChunk = (content) => {
        streamedContent += content;
        const contentEl = messageDiv.querySelector('.message-content');
        if (contentEl) contentEl.textContent = streamedContent;
        scrollToBottom();
    };

    // Extracted completion logic unifying multiple done states
    const handleDone = async (thinking = '') => {
        if (directModeDone) return;
        directModeDone = true;
        
        if (thinking) {
            thinkingContent = thinking;
        } else if (typeof extractThinkingFromContent === 'function') {
            const extracted = extractThinkingFromContent(streamedContent);
            if (extracted?.thinking) {
                thinkingContent = extracted.thinking;
                streamedContent = extracted.content;
            }
        }

        const generationTimeMs = startTime ? (Date.now() - startTime) : null;
        const tokensGenerated = streamedContent ? Math.ceil(streamedContent.length / 4) : 0;
        const tokenSpeed = generationTimeMs > 0 && tokensGenerated > 0 ? (tokensGenerated / (generationTimeMs / 1000)) : 0;

        const tokenUpdater = typeof window.updateTokenCounterFromText === 'function' ? window.updateTokenCounterFromText : window.features?.updateTokenCounterFromText;
        if (tokenUpdater) tokenUpdater(message, streamedContent, generationTimeMs);

        if (typeof window.updateTimingSummary === 'function') {
            window.updateTimingSummary({
                requestStart: startTime || performance.now(),
                total: generationTimeMs || 0,
                llm: firstTokenTime || generationTimeMs * 0.6 || 0,
                llmDone: generationTimeMs * 0.8 || 0,
                tts: audioChunkCount > 0 ? generationTimeMs * 0.4 : 0,
                audioPlayStart: audioChunkCount > 0 ? generationTimeMs * 0.9 : 0,
                tokens: tokensGenerated,
                tokensPerSecond: tokenSpeed
            });
        }

        messageDiv.innerHTML = '';

        if (thinkingContent) {
            const thinkingContainer = document.createElement('div');
            thinkingContainer.className = 'thinking-container collapsed';
            thinkingContainer.innerHTML = `
                <div class="thinking-header">
                    <span class="thinking-toggle">▶ Thinking</span>
                    <span class="thinking-label">(${thinkingContent.length} chars)</span>
                </div>
                <div class="thinking-content"></div>
            `;
            thinkingContainer.querySelector('.thinking-content').textContent = thinkingContent;
            thinkingContainer.querySelector('.thinking-header').addEventListener('click', () => {
                thinkingContainer.classList.toggle('collapsed');
                thinkingContainer.querySelector('.thinking-toggle').textContent = thinkingContainer.classList.contains('collapsed') ? '▶ Thinking' : '▼ Thinking';
            });
            messageDiv.appendChild(thinkingContainer);
        }

        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        headerDiv.innerHTML = `
            <span class="message-label">AI</span>
            ${audioChunkCount > 0 ? '<span class="tts-playing" style="display: none;">🔊 Speaking...</span>' : ''}
            <button class="speak-btn" title="Speak">Speak</button>
            <button class="pause-btn" title="Pause" style="display: none;">⏸</button>
            <button class="stop-btn" title="Stop" style="display: none;">⏹</button>
            <button class="copy-btn" title="Copy">Copy</button>
        `;

        headerDiv.querySelector('.copy-btn').addEventListener('click', (e) => copyToClipboard(streamedContent, e.target));

        headerDiv.querySelector('.stop-btn').addEventListener('click', () => {
            fetch('/api/tts/stream/cancel', { method: 'POST' }).catch(() => {});
            if (typeof window.stopTTSAudio === 'function') window.stopTTSAudio();
            setTTSButtonState(messageDiv, 'idle');
        });

        headerDiv.querySelector('.speak-btn').addEventListener('click', async () => {
            if (isPaused && currentMessageDiv === messageDiv) {
                isPaused = false;
                ensureAudioContext();
                playQueuedAudio();
                setTTSButtonState(messageDiv, 'playing');
                return;
            }

            const speaker = document.getElementById('ttsSpeaker')?.value || 'en';
            
            // FIX: Triggers `speakText` FIRST so `stopTTSAudio()` safely clears ANY OLD playback interface...
            const speakPromise = speakText(streamedContent, speaker);
            
            // ...THEN update current properties to ensure the state isn't immediately overwritten.
            currentMessageDiv = messageDiv;
            setTTSButtonState(messageDiv, 'playing');

            try {
                await speakPromise;
            } catch (err) {
                console.error('[TTS] Speak error:', err);
                setTTSButtonState(messageDiv, 'idle');
            }
        });

        messageDiv.appendChild(headerDiv);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv[typeof renderMarkdown === 'function' ? 'innerHTML' : 'textContent'] = typeof renderMarkdown === 'function' ? renderMarkdown(streamedContent) : streamedContent;
        messageDiv.appendChild(contentDiv);
        
        scrollToBottom();
        
        if (typeof conversationMode !== 'undefined' && conversationMode && streamedContent && !isDirectLMStudio) {
            await speakText(streamedContent, document.getElementById('ttsSpeaker')?.value || 'en');
        }
    };

    try {
        let systemPrompt = systemPromptInput?.value || 'You are a helpful AI assistant.';
        const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
        
        if (ttsSpeakerSelect?.value && window.features) {
            const voiceProfile = window.features.getVoiceProfile(ttsSpeakerSelect.value);
            if (voiceProfile?.personality && !systemPrompt.includes(voiceProfile.name)) {
                systemPrompt = `${systemPrompt}\n\n## Current Character: ${voiceProfile.name}\n${voiceProfile.personality}`;
            }
        }
        
        let processedAttachments = [];
        for (const file of attachments ||[]) {
            const isImage = file.type.startsWith('image/') || file.name.match(/\.(png|jpe?g|gif|webp|bmp|svg)$/i);
            processedAttachments.push({
                type: isImage ? 'image' : 'document',
                name: file.name,
                mimeType: file.type,
                ...(isImage && { data: await fileToBase64(file) })
            });
        }

        let fetchBody;
        if (useDirectMode) {
            const messages = systemPrompt ? [{ role: 'system', content: systemPrompt }] :[];
            const imageAttachments = processedAttachments.filter(a => a.type === 'image');
            
            if (imageAttachments.length > 0) {
                const contentParts = message ? [{ type: 'text', text: message }] :[];
                imageAttachments.forEach(img => contentParts.push({ type: 'image_url', image_url: { url: img.data } }));
                messages.push({ role: 'user', content: contentParts });
            } else {
                messages.push({ role: 'user', content: message });
            }
            fetchBody = JSON.stringify({ model: modelSelect.value, messages, stream: true });
        } else {
            const reqObj = { message, session_id: SessionManager.sessionId, model: modelSelect.value, system_prompt: systemPrompt, attachments: processedAttachments };
            if (ttsSpeakerSelect?.value) reqObj.speaker = ttsSpeakerSelect.value;
            fetchBody = JSON.stringify(reqObj);
        }
        
        const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fetchBody });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            sseBuffer += decoder.decode(value, { stream: true });
            const events = sseBuffer.split('\n\n');
            sseBuffer = events.pop() || '';
            
            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const dataStr = line.slice(6);
                    if (dataStr.trim() === '') continue;
                    
                    if (dataStr === '[DONE]') {
                        if (isDirectLMStudio) await handleDone();
                        continue;
                    }
                    
                    try {
                        const data = JSON.parse(dataStr);
                        
                        if (isDirectLMStudio && data.choices?.[0]) {
                            if (data.choices[0].delta?.content) {
                                if (firstTokenTime === null) firstTokenTime = Date.now() - startTime;
                                handleChunk(data.choices[0].delta.content);
                            }
                            if (data.choices[0].finish_reason === 'stop') await handleDone();
                            continue;
                        }
                        
                        if (data.type === 'content') {
                            handleChunk(data.content);
                        } else if (data.type === 'audio') {
                            window.TTSQueue?.enqueueAudio?.(data.audio, data.sample_rate);
                            audioChunkCount++;
                            const ttsIndicator = messageDiv.querySelector('.tts-playing');
                            if (ttsIndicator) ttsIndicator.style.display = 'inline-flex';
                            window.TTSQueue?.playNextAudio?.();
                        } else if (data.type === 'done') {
                            await handleDone(data.thinking);
                        } else if (data.type === 'error') {
                            messageDiv.querySelector('.message-content').innerHTML = `<span class="error">${data.error || 'An error occurred'}</span>`;
                        }
                    } catch (e) {
                        console.error('Error parsing SSE:', e);
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
        
        if (window.SessionManager && message && streamedContent) {
            const currentSession = window.sessions?.find(s => s.id === window.sessionId);
            if (currentSession && (currentSession.title === 'New Chat' || !currentSession.title)) {
                const smartTitle = await generateSmartTitle(message, streamedContent);
                if (smartTitle) SessionManager.updateSessionTitle(window.sessionId, smartTitle);
            }
        }
        SessionManager.renderSessionList();
    }
}

async function speakText(text, speaker = 'en') {
    if (!text) return;
    
    if (typeof stopAudioRequested !== 'undefined') stopAudioRequested = false;
    if (typeof resetCrossfadeState === 'function') resetCrossfadeState();
    
    if (typeof conversationMode !== 'undefined' && conversationMode) {
        if(typeof micBtn !== 'undefined') micBtn.disabled = true;
        if(typeof conversationStatus !== 'undefined') conversationStatus.textContent = '🔊 Speaking...';
    }
    
    try {
        await speakTextStreaming(text, speaker);
    } catch (error) {
        console.error('[TTS] SSE streaming failed:', error);
        try {
            const batchResponse = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, speaker })
            });
            const data = await batchResponse.json();
            if (data.success && data.audio && window.AudioPlayer?.playTTS) {
                await window.AudioPlayer.playTTS(data.audio);
            }
        } catch (batchError) {
            console.error('[TTS] Fallback failed:', batchError);
        }
    } finally {
        if (typeof conversationMode !== 'undefined' && conversationMode) {
            if(typeof micBtn !== 'undefined') micBtn.disabled = false;
            if(typeof conversationStatus !== 'undefined') conversationStatus.textContent = '🎙️ Voice Mode Active';
        }
    }
}

let currentStreamController = null;
let audioQueue =[];
let isPlaying = false;
let currentAudioSource = null;
let isPaused = false;
let currentMessageDiv = null;
let isFetching = false;

// Minified state handler removing bulky switch blocks
function setTTSButtonState(messageDiv, state) {
    const speakBtn = messageDiv.querySelector('.speak-btn');
    const stopBtn = messageDiv.querySelector('.stop-btn');
    const pauseBtn = messageDiv.querySelector('.pause-btn');

    if (!speakBtn || !stopBtn || !pauseBtn) return;

    speakBtn.style.display = (state === 'idle' || state === 'paused') ? 'inline-flex' : 'none';
    speakBtn.textContent = state === 'paused' ? 'Resume' : 'Speak';
    speakBtn.disabled = false;
    
    stopBtn.style.display = (state === 'playing' || state === 'paused') ? 'inline-flex' : 'none';
    pauseBtn.style.display = state === 'playing' ? 'inline-flex' : 'none';
    pauseBtn.textContent = '⏸';
}

function onAudioPlaybackComplete() {
  isPlaying = false;
  isPaused = false;
  if (currentMessageDiv) {
    setTTSButtonState(currentMessageDiv, 'idle');
    currentMessageDiv = null;
  }
}

function base64ToFloat32(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
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
  if (isPlaying) return;
  if (audioQueue.length === 0) {
    isPlaying = false;
    currentAudioSource = null;
    onAudioPlaybackComplete();
    return;
  }
  
  ensureAudioContext();
  
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
      isPlaying = false;
      currentAudioSource = null;
      if (!isPaused) playQueuedAudio();
    };
    source.start();
  }
}

function stopTTSAudio() {
  if (currentStreamController) {
      currentStreamController.abort();
      currentStreamController = null;
  }
  if (currentAudioSource) {
    try { currentAudioSource.stop(); } catch (e) {}
    currentAudioSource = null;
  }
  audioQueue =[];
  isPlaying = false;
  isPaused = false;
  isFetching = false;

  if (currentMessageDiv) {
      setTTSButtonState(currentMessageDiv, 'idle');
      currentMessageDiv = null;
  }
}

function pauseTTSAudio() {
  try {
    const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null);
    if (audioCtx?.state === 'running') audioCtx.suspend();
  } catch (e) { console.warn('[TTS] pause error', e); }
  isPaused = true;
  isPlaying = false;
}

window.stopTTSAudio = stopTTSAudio;
window.pauseTTSAudio = pauseTTSAudio;
window.setTTSButtonState = setTTSButtonState;

function ensureAudioContext() {
  try {
    const audioCtx = window.AudioPlayer?.getWebAudioContext?.() || (typeof window.webAudioContext !== 'undefined' ? window.webAudioContext : null);
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  } catch (e) { console.warn('[TTS] Failed to resume AudioContext', e); }
}

window.testTTSControls = function() {
    console.log('=== TTS CONTROLS TEST ===\nTesting stops/pauses', {isPlaying, isPaused, length: audioQueue.length});
    stopTTSAudio();
    pauseTTSAudio();
    ensureAudioContext();
    return { isPlaying, isPaused, audioQueueLength: audioQueue.length };
};

async function speakTextStreaming(text, speaker = 'en') {
  stopTTSAudio();
  if (isFetching) return;
  if (audioQueue.length > 0 && !isPaused) { ensureAudioContext(); playQueuedAudio(); return; }
  if (isPaused && audioQueue.length > 0) { isPaused = false; ensureAudioContext(); playQueuedAudio(); return; }
  
  isFetching = true;
  return new Promise((resolve, reject) => {
    if (currentStreamController) currentStreamController.abort();
    currentStreamController = new AbortController();
    
    const formData = new FormData();
    formData.append('text', text);
    formData.append('speaker', speaker || 'default');
    formData.append('language', 'en');
    
    window.currentStreamAbort = () => { if (currentStreamController) currentStreamController.abort(); };
    
    fetch('/api/tts/stream/server-sent-events', {
      method: 'POST',
      body: formData,
      signal: currentStreamController.signal
    }).then(async response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
      while (true) {
        if (typeof stopAudioRequested !== 'undefined' && stopAudioRequested) {
          reader.cancel();
          currentStreamController.abort();
          resolve();
          return;
        }
        
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'chunk') {
                scheduleChunk(base64ToFloat32(data.audio_b64), data.sample_rate);
                if (!isPlaying) playQueuedAudio();
              } else if (data.type === 'done') {
                reader.cancel();
                resolve();
                return;
              } else if (data.type === 'error') {
                reject(new Error(data.message));
              }
            } catch (e) { console.error('[TTS] Parse error:', e); }
          }
        }
      }
    }).catch(err => {
      if (err.name !== 'AbortError') reject(err);
    }).finally(() => {
      currentStreamController = null;
      isFetching = false;
    });
  });
}

async function speakTextLegacy(text, speaker = 'en') {
  return new Promise((resolve, reject) => {
    let audioQueue =[];
    let isPlaying = false;
    
    async function playNextAudio() {
      if (isPlaying || audioQueue.length === 0) return;
      isPlaying = true;
      while (audioQueue.length > 0) {
        const { audio, sampleRate } = audioQueue.shift();
        try {
          if (window.AudioPlayer?.playTTS) await window.AudioPlayer.playTTS(audio, sampleRate);
        } catch (e) { console.error('[TTS] Playback error:', e); }
      }
      isPlaying = false;
    }
    
    fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speaker })
    }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      return new Promise((resolveLegacy, rejectLegacy) => {
        function processStream() {
          reader.read().then(({ done, value }) => {
            if (done) return resolveLegacy();
            let binary = '';
            for (let i = 0; i < value.length; i++) binary += String.fromCharCode(value[i]);
            audioQueue.push({ audio: btoa(binary), sampleRate: 24000 });
            playNextAudio();
            processStream();
          }).catch(rejectLegacy);
        }
        processStream();
      });
    }).then(() => {
      return new Promise(resolveWait => {
        const checkComplete = () => (isPlaying || audioQueue.length > 0) ? setTimeout(checkComplete, 100) : resolveWait();
        checkComplete();
      });
    }).then(resolve).catch(reject);
  });
}

async function clearChat() {
    messagesContainer.innerHTML = '';
    welcomeMessage.classList.remove('hidden');
    try {
        await fetch('/api/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: SessionManager.sessionId })
        });
    } catch (error) { console.error('Error clearing session:', error); }
    messageInput.focus();
}

async function loadSystemPrompt() {
    if (!SessionManager.sessionId) return;
    try {
        const response = await fetch(`/api/sessions/${SessionManager.sessionId}`);
        const data = await response.json();
        systemPromptInput.value = (data.success && data.session.system_prompt) ? data.session.system_prompt : 'You are a helpful AI assistant.';
    } catch (error) { systemPromptInput.value = 'You are a helpful AI assistant.'; }
}

async function saveSystemPromptHandler() {
    try {
        await fetch(`/api/sessions/${SessionManager.sessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                system_prompt: systemPromptInput.value,
                global_system_prompt: typeof globalSystemPromptInput !== 'undefined' ? globalSystemPromptInput?.value : ''
            })
        });
    } catch (error) { console.error('Error saving system prompt:', error); }
}

window.ChatAPI = { sendMessage, speakText, speakTextStreaming, speakTextLegacy, clearChat, loadSystemPrompt, saveSystemPromptHandler };

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('pause-btn')) {
        const messageDiv = e.target.closest('.message');
        if (typeof window.pauseTTSAudio === 'function') window.pauseTTSAudio();
        setTTSButtonState(messageDiv, 'paused');
    }
});