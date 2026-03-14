/**
 * LM Studio Chatbot - Message Renderer
 * Handles message display and markdown rendering
 */

// Current audio element for playback - SEPARATE from voice.js currentAudio

// Add message to chat
function addMessage(role, content, thinking = null, tokens = null, tokensPerSec = '', attachments = null) {
    if (role === 'assistant') role = 'ai';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    // Add attachments display for user messages
    if (attachments && attachments.length > 0 && role === 'user') {
        const attachmentsDiv = document.createElement('div');
        attachmentsDiv.className = 'message-attachments';
        
        for (const att of attachments) {
            if (att.type === 'image') {
                const img = document.createElement('img');
                img.src = att.data;
                img.alt = att.name;
                img.className = 'message-attachment-image';
                attachmentsDiv.appendChild(img);
            } else {
                const doc = document.createElement('div');
                doc.className = 'message-attachment-doc';
                doc.innerHTML = `<span class="doc-icon">📄</span> ${att.name}`;
                attachmentsDiv.appendChild(doc);
            }
        }
        
        messageDiv.appendChild(attachmentsDiv);
    }
    
    if (role === 'ai' || role === 'assistant') {
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
        headerHTML += `<button class="pause-btn" title="Pause" style="display: none;">⏸</button>`;
        headerHTML += `<button class="stop-btn" title="Stop" style="display: none;">⏹</button>`;
        headerHTML += `<button class="copy-btn" title="Copy">Copy</button>`;
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        headerDiv.innerHTML = headerHTML;
        
        headerDiv.querySelector('.copy-btn').addEventListener('click', (e) => {
            copyToClipboard(content, e.target);
        });
        
        headerDiv.querySelector('.stop-btn').addEventListener('click', (e) => {
            console.log('[STOP] Stop button clicked');
            // Reset pause state
            isPaused = false;
            
            // Try to cancel TTS stream via API
            fetch('/api/tts/stream/cancel', { method: 'POST' }).catch(() => {});
            
            // Try all possible stop functions
            if (typeof stopAudio === 'function') stopAudio();
            if (typeof window.stopTTSAudio === 'function') window.stopTTSAudio();
            if (typeof stopTTSPlayback === 'function') stopTTSPlayback();
            if (typeof window.TTSQueue?.stop === 'function') window.TTSQueue.stop();
            
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
        
        // Remove duplicate handler
        headerDiv.querySelector('.stop-btn').onclick = null;
        
        headerDiv.querySelector('.speak-btn').addEventListener('click', (e) => {
            const btn = e.target;
            currentMessageDiv = messageDiv;
            
            // If paused, resume
            if (isPaused) {
                isPaused = false;
                playQueuedAudio();
                btn.disabled = true;
                btn.textContent = 'Speaking...';
                btn.style.display = 'none';
                const stopBtn = messageDiv.querySelector('.stop-btn');
                const pauseBtn = messageDiv.querySelector('.pause-btn');
                if (stopBtn) stopBtn.style.display = 'inline-flex';
                if (pauseBtn) pauseBtn.style.display = 'inline-flex';
                return;
            }
            
            btn.disabled = true;
            btn.textContent = 'Speaking...';
            btn.style.display = 'none';
            const stopBtn = messageDiv.querySelector('.stop-btn');
            const pauseBtn = messageDiv.querySelector('.pause-btn');
            if (stopBtn) stopBtn.style.display = 'inline-flex';
            if (pauseBtn) pauseBtn.style.display = 'inline-flex';
            
            const ttsSpeakerSelect = document.getElementById('ttsSpeaker');
            speakText(content, ttsSpeakerSelect ? ttsSpeakerSelect.value : 'en').then(() => {
                // Audio completed naturally - buttons will be hidden by onAudioPlaybackComplete
            }).catch(() => {
                if (stopBtn) stopBtn.style.display = 'none';
                if (pauseBtn) pauseBtn.style.display = 'none';
                btn.style.display = 'inline-flex';
                btn.disabled = false;
            });
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

// Scroll to bottom
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Render markdown
function renderMarkdown(text) {
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }
    return text.replace(/\n/g, '<br>');
}

// Copy to clipboard
function copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
        button.textContent = 'Copied!';
        button.classList.add('copied');
        setTimeout(() => {
            button.textContent = 'Copy';
            button.classList.remove('copied');
        }, 2000);
    });
}

// Export for use in other modules
window.MessageRenderer = {
    addMessage,
    extractThinkingFromContent,
    renderMarkdown,
    copyToClipboard,
    scrollToBottom
};