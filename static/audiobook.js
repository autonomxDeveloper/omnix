/**
 * Audiobook Feature Module
 * Text-to-speech for documents with multi-speaker support
 */

// Audiobook state
let audiobookState = {
    text: '',
    segments: [],
    speakers: {},
    voiceMapping: {},
    defaultVoices: {
        female: null,
        male: null,
        narrator: null
    },
    audioQueue: [],
    isPlaying: false,
    isGenerating: false,
    currentSegment: 0,
    totalSegments: 0
};

// DOM elements (initialized in initAudiobook)
let audiobookModal, audiobookText, audiobookFile, audiobookAnalyzeBtn;
let audiobookSpeakersSection, audiobookSpeakersList, audiobookGenerateBtn;
let audiobookProgress, audiobookProgressBar, audiobookProgressText;
let audiobookPlayer, audiobookAudio;

// Initialize audiobook feature
function initAudiobook() {
    // Get DOM elements
    audiobookModal = document.getElementById('audiobook-modal');
    audiobookText = document.getElementById('audiobook-text');
    audiobookFile = document.getElementById('audiobook-file');
    audiobookAnalyzeBtn = document.getElementById('audiobook-analyze-btn');
    audiobookSpeakersSection = document.getElementById('audiobook-speakers-section');
    audiobookSpeakersList = document.getElementById('audiobook-speakers-list');
    audiobookGenerateBtn = document.getElementById('audiobook-generate-btn');
    audiobookProgress = document.getElementById('audiobook-progress');
    audiobookProgressBar = document.getElementById('audiobook-progress-bar');
    audiobookProgressText = document.getElementById('audiobook-progress-text');
    audiobookPlayer = document.getElementById('audiobook-player');
    audiobookAudio = document.getElementById('audiobook-audio');
    
    // Set up event listeners
    if (audiobookAnalyzeBtn) {
        audiobookAnalyzeBtn.addEventListener('click', analyzeAudiobookText);
    }
    
    if (audiobookGenerateBtn) {
        audiobookGenerateBtn.addEventListener('click', generateAudiobook);
    }
    
    if (audiobookFile) {
        audiobookFile.addEventListener('change', handleAudiobookFileUpload);
    }
    
    console.log('[AUDIOBOOK] Initialized');
}

// Open audiobook modal
function openAudiobookModal() {
    if (audiobookModal) {
        audiobookModal.classList.add('active');
        // Reset state
        resetAudiobookState();
    }
}

// Close audiobook modal
function closeAudiobookModal() {
    if (audiobookModal) {
        audiobookModal.classList.remove('active');
    }
    // Stop any playing audio
    if (audiobookAudio && audiobookAudio.pause) {
        audiobookAudio.pause();
    }
    audiobookState.isPlaying = false;
}

// Reset audiobook state
function resetAudiobookState() {
    audiobookState = {
        text: '',
        segments: [],
        speakers: {},
        voiceMapping: {},
        defaultVoices: {
            female: null,
            male: null,
            narrator: null
        },
        audioQueue: [],
        isPlaying: false,
        isGenerating: false,
        currentSegment: 0,
        totalSegments: 0
    };
    
    if (audiobookText) audiobookText.value = '';
    if (audiobookFile) audiobookFile.value = '';
    if (audiobookSpeakersSection) audiobookSpeakersSection.style.display = 'none';
    if (audiobookProgress) audiobookProgress.style.display = 'none';
    if (audiobookPlayer) audiobookPlayer.style.display = 'none';
}

// Handle file upload
async function handleAudiobookFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const filename = file.name.toLowerCase();
    
    if (filename.endsWith('.txt')) {
        const text = await file.text();
        if (audiobookText) {
            audiobookText.value = text;
        }
    } else if (filename.endsWith('.pdf')) {
        // PDF needs server-side processing
        const formData = new FormData();
        formData.append('file', file);
        
        try {
            const response = await fetch('/api/audiobook/upload', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            if (data.success) {
                // Store segments directly
                audiobookState.segments = data.segments;
                audiobookState.text = 'Loaded from PDF';
                
                // Show speakers section
                displaySpeakers(data.speakers, data.segments);
            } else {
                alert('Error loading PDF: ' + data.error);
            }
        } catch (error) {
            alert('Error uploading file: ' + error.message);
        }
    }
}

// Analyze text for speakers
async function analyzeAudiobookText() {
    const text = audiobookText ? audiobookText.value.trim() : '';
    
    if (!text) {
        alert('Please enter or upload some text first');
        return;
    }
    
    audiobookAnalyzeBtn.disabled = true;
    audiobookAnalyzeBtn.textContent = 'Analyzing...';
    
    try {
        const response = await fetch('/api/audiobook/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });
        
        const data = await response.json();
        
        if (data.success) {
            audiobookState.text = text;
            audiobookState.segments = data.segments;
            
            // Display speakers for voice assignment
            displaySpeakers(data.speakers, data.segments);
        } else {
            alert('Error analyzing text: ' + data.error);
        }
    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        audiobookAnalyzeBtn.disabled = false;
        audiobookAnalyzeBtn.textContent = 'Analyze Text';
    }
}

// Display speakers for voice assignment
async function displaySpeakers(speakers, segments) {
    if (!audiobookSpeakersSection || !audiobookSpeakersList) return;
    
    // Get available voices
    let availableVoices = [];
    try {
        const response = await fetch('/api/tts/speakers');
        const data = await response.json();
        if (data.success) {
            availableVoices = data.speakers.map(s => s.id || s.name);
        }
    } catch (error) {
        console.error('Error fetching voices:', error);
    }
    
    // Detect speakers and get suggestions
    try {
        const response = await fetch('/api/audiobook/speakers/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: audiobookState.text })
        });
        
        const data = await response.json();
        if (data.success) {
            audiobookState.speakers = data.speakers;
            availableVoices = data.available_voices;
        }
    } catch (error) {
        console.error('Error detecting speakers:', error);
    }
    
    // Build speakers UI
    let html = '<div class="audiobook-speakers-header">';
    html += '<h4>Speakers Detected</h4>';
    html += '<p>Assign voices to each speaker, or use auto-detected suggestions</p>';
    html += '</div>';
    
    html += '<div class="audiobook-default-voices">';
    html += '<h5>Default Voices</h5>';
    html += '<div class="default-voice-row">';
    html += '<label>Female: </label>';
    html += '<select id="default-voice-female" onchange="updateDefaultVoice(\'female\', this.value)">';
    html += '<option value="">-- Select --</option>';
    availableVoices.forEach(v => {
        html += `<option value="${v}">${v}</option>`;
    });
    html += '</select></div>';
    
    html += '<div class="default-voice-row">';
    html += '<label>Male: </label>';
    html += '<select id="default-voice-male" onchange="updateDefaultVoice(\'male\', this.value)">';
    html += '<option value="">-- Select --</option>';
    availableVoices.forEach(v => {
        html += `<option value="${v}">${v}</option>`;
    });
    html += '</select></div>';
    
    html += '<div class="default-voice-row">';
    html += '<label>Narrator: </label>';
    html += '<select id="default-voice-narrator" onchange="updateDefaultVoice(\'narrator\', this.value)">';
    html += '<option value="">-- Select --</option>';
    availableVoices.forEach(v => {
        html += `<option value="${v}">${v}</option>`;
    });
    html += '</select></div></div>';
    
    // Individual speaker assignments
    html += '<div class="audiobook-speaker-assignments">';
    html += '<h5>Individual Speakers</h5>';
    
    for (const [speakerName, speakerInfo] of Object.entries(audiobookState.speakers)) {
        const gender = speakerInfo.gender || 'neutral';
        const suggested = speakerInfo.suggested_voice || '';
        const segmentCount = speakerInfo.segment_count || 0;
        
        html += `<div class="speaker-assignment-row" data-gender="${gender}">`;
        html += `<div class="speaker-info">`;
        html += `<span class="speaker-name">${speakerName}</span>`;
        html += `<span class="speaker-meta">${gender} • ${segmentCount} segments</span>`;
        html += `</div>`;
        html += `<select class="speaker-voice-select" data-speaker="${speakerName}" onchange="updateVoiceMapping('${speakerName}', this.value)">`;
        html += '<option value="">-- Auto --</option>';
        availableVoices.forEach(v => {
            const selected = v === suggested ? 'selected' : '';
            html += `<option value="${v}" ${selected}>${v}</option>`;
        });
        html += '</select></div>';
    }
    
    html += '</div>';
    
    // Summary
    html += `<div class="audiobook-summary">`;
    html += `<p><strong>Total Segments:</strong> ${segments.length}</p>`;
    html += `<p><strong>Unique Speakers:</strong> ${Object.keys(audiobookState.speakers).length}</p>`;
    html += `</div>`;
    
    audiobookSpeakersList.innerHTML = html;
    audiobookSpeakersSection.style.display = 'block';
    
    // Auto-select default voices based on gender detection
    autoSelectDefaultVoices(availableVoices);
}

// Auto-select default voices
function autoSelectDefaultVoices(availableVoices) {
    // Try to find female voice
    const femaleVoice = availableVoices.find(v => 
        ['sofia', 'emma', 'olivia', 'her', 'ciri', 'serena', 'sohee'].some(n => v.toLowerCase().includes(n))
    );
    if (femaleVoice) {
        const select = document.getElementById('default-voice-female');
        if (select) {
            select.value = femaleVoice;
            updateDefaultVoice('female', femaleVoice);
        }
    }
    
    // Try to find male voice
    const maleVoice = availableVoices.find(v => 
        ['morgan', 'james', 'nate', 'inigo', 'eric', 'ryan', 'aiden'].some(n => v.toLowerCase().includes(n))
    );
    if (maleVoice) {
        const select = document.getElementById('default-voice-male');
        if (select) {
            select.value = maleVoice;
            updateDefaultVoice('male', maleVoice);
        }
    }
    
    // Narrator defaults to first available or female
    const narratorVoice = femaleVoice || maleVoice || availableVoices[0];
    if (narratorVoice) {
        const select = document.getElementById('default-voice-narrator');
        if (select) {
            select.value = narratorVoice;
            updateDefaultVoice('narrator', narratorVoice);
        }
    }
}

// Update voice mapping
function updateVoiceMapping(speakerName, voiceId) {
    if (voiceId) {
        audiobookState.voiceMapping[speakerName] = voiceId;
    } else {
        delete audiobookState.voiceMapping[speakerName];
    }
}

// Update default voice
function updateDefaultVoice(gender, voiceId) {
    audiobookState.defaultVoices[gender] = voiceId || null;
}

// Generate audiobook with streaming playback
async function generateAudiobook() {
    if (audiobookState.segments.length === 0) {
        alert('No segments to generate. Please analyze text first.');
        return;
    }
    
    audiobookState.isGenerating = true;
    audiobookState.isPlaying = true;
    audiobookState.audioQueue = [];
    audiobookState.currentSegment = 0;
    audiobookState.totalSegments = audiobookState.segments.length;
    
    // Show progress and player immediately
    if (audiobookProgress) audiobookProgress.style.display = 'block';
    showStreamingPlayer();
    
    if (audiobookGenerateBtn) {
        audiobookGenerateBtn.disabled = true;
        audiobookGenerateBtn.textContent = 'Generating...';
    }
    
    updateProgress(0, 'Starting generation...');
    
    try {
        const response = await fetch('/api/audiobook/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                segments: audiobookState.segments,
                voice_mapping: audiobookState.voiceMapping,
                default_voices: audiobookState.defaultVoices
            })
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
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
                                // Add to queue
                                audiobookState.audioQueue.push({
                                    audio: data.audio,
                                    sampleRate: data.sample_rate,
                                    speaker: data.speaker,
                                    text: data.text,
                                    voiceUsed: data.voice_used,
                                    index: data.segment_index
                                });
                                
                                audiobookState.currentSegment = data.segment_index + 1;
                                const percent = Math.round((audiobookState.currentSegment / audiobookState.totalSegments) * 100);
                                updateProgress(percent, `Generated ${audiobookState.currentSegment}/${audiobookState.totalSegments} segments`);
                                
                                // Start playing if not already playing
                                if (!streamingPlaybackInProgress && audiobookState.isPlaying) {
                                    playStreamingAudio();
                                }
                                
                            } else if (data.type === 'done') {
                                updateProgress(100, 'Generation complete!');
                                updateStreamingStatus('Generation complete!');
                                
                                // Stop streaming playback and show full controls
                                stopStreamingAudio();
                                showFullPlaybackControls();
                                
                            } else if (data.type === 'error') {
                                console.error('Audiobook error:', data.error);
                                updateProgress(-1, `Error: ${data.error}`);
                            }
                        } catch (e) {
                            console.error('Parse error:', e);
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('Generation error:', error);
        updateProgress(-1, `Error: ${error.message}`);
    } finally {
        audiobookState.isGenerating = false;
        if (audiobookGenerateBtn) {
            audiobookGenerateBtn.disabled = false;
            audiobookGenerateBtn.textContent = 'Generate Audiobook';
        }
    }
}

// Streaming playback state
let streamingPlaybackInProgress = false;
let streamingAudioIndex = 0;
let streamingAudioElement = null;

// Combined audio for playback controls
let combinedAudioBlob = null;
let combinedAudioUrl = null;
let combinedAudioElement = null;
let audioSegmentDurations = []; // Track duration of each segment for seeking

// Show streaming player (minimal controls that appear immediately)
function showStreamingPlayer() {
    if (!audiobookPlayer) return;
    
    audiobookPlayer.style.display = 'block';
    
    let html = '<div class="audiobook-controls">';
    html += '<button id="audiobook-pause-btn" class="btn-secondary" onclick="pauseStreamingAudio()">⏸ Pause</button>';
    html += '<button id="audiobook-resume-btn" class="btn-primary" onclick="resumeStreamingAudio()" style="display:none;">▶ Resume</button>';
    html += '<button class="btn-secondary" onclick="stopStreamingAudio()">⏹ Stop</button>';
    html += '<span id="audiobook-status">Generating and streaming...</span>';
    html += '</div>';
    
    // Show segment info
    html += '<div class="audiobook-segment-info" id="audiobook-segment-info">';
    html += '<p>Preparing first audio segment...</p>';
    html += '</div>';
    
    audiobookPlayer.innerHTML = html;
    
    streamingPlaybackInProgress = false;
    streamingAudioIndex = 0;
}

// Play streaming audio - plays chunks as they arrive
async function playStreamingAudio() {
    streamingPlaybackInProgress = true;
    
    while (audiobookState.isPlaying) {
        // Wait for next chunk if not available yet
        if (streamingAudioIndex >= audiobookState.audioQueue.length) {
            // If generation is done and we've played everything, stop
            if (!audiobookState.isGenerating) {
                updateStreamingStatus('Playback complete!');
                break;
            }
            // Wait for next chunk
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
        }
        
        const segment = audiobookState.audioQueue[streamingAudioIndex];
        
        // Update status
        updateStreamingStatus(`Playing ${streamingAudioIndex + 1}/${audiobookState.totalSegments}`);
        updateSegmentInfo(segment);
        
        // Play the segment
        try {
            await playAudioSegment(segment);
            streamingAudioIndex++;
        } catch (error) {
            console.error('Error playing segment:', error);
            streamingAudioIndex++;
        }
    }
    
    streamingPlaybackInProgress = false;
}

// Play a single audio segment
function playAudioSegment(segment) {
    return new Promise((resolve, reject) => {
        try {
            // Convert raw PCM to WAV for playback
            const wavBuffer = createWavBufferFromBase64(segment.audio, segment.sampleRate);
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            const audioUrl = URL.createObjectURL(blob);
            
            if (streamingAudioElement) {
                streamingAudioElement.pause();
                URL.revokeObjectURL(streamingAudioElement.src);
            }
            
            streamingAudioElement = new Audio(audioUrl);
            
            streamingAudioElement.onended = () => {
                URL.revokeObjectURL(audioUrl);
                resolve();
            };
            
            streamingAudioElement.onerror = (e) => {
                console.error('Audio playback error:', e);
                URL.revokeObjectURL(audioUrl);
                reject(e);
            };
            
            streamingAudioElement.play();
            
        } catch (error) {
            reject(error);
        }
    });
}

// Update streaming status
function updateStreamingStatus(text) {
    const statusEl = document.getElementById('audiobook-status');
    if (statusEl) statusEl.textContent = text;
}

// Update segment info display
function updateSegmentInfo(segment) {
    const infoEl = document.getElementById('audiobook-segment-info');
    if (infoEl) {
        infoEl.innerHTML = `
            <p><strong>Speaker:</strong> ${segment.speaker || 'Unknown'}</p>
            <p><strong>Voice:</strong> ${segment.voiceUsed || 'Default'}</p>
            <p><strong>Text:</strong> ${segment.text || ''}</p>
        `;
    }
}

// Pause streaming audio
function pauseStreamingAudio() {
    audiobookState.isPlaying = false;
    
    if (streamingAudioElement) {
        streamingAudioElement.pause();
    }
    
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    const resumeBtn = document.getElementById('audiobook-resume-btn');
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (resumeBtn) resumeBtn.style.display = 'inline-block';
    
    updateStreamingStatus('Paused');
}

// Resume streaming audio
function resumeStreamingAudio() {
    audiobookState.isPlaying = true;
    
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    const resumeBtn = document.getElementById('audiobook-resume-btn');
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    if (resumeBtn) resumeBtn.style.display = 'none';
    
    // Resume playing from current position
    if (streamingAudioElement && streamingAudioElement.paused) {
        streamingAudioElement.play();
    }
    
    // Continue streaming playback
    if (!streamingPlaybackInProgress) {
        playStreamingAudio();
    }
}

// Stop streaming audio
function stopStreamingAudio() {
    audiobookState.isPlaying = false;
    streamingPlaybackInProgress = false;
    streamingAudioIndex = 0;
    
    if (streamingAudioElement) {
        streamingAudioElement.pause();
        streamingAudioElement.currentTime = 0;
    }
    
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    const resumeBtn = document.getElementById('audiobook-resume-btn');
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    if (resumeBtn) resumeBtn.style.display = 'none';
    
    updateStreamingStatus('Stopped');
}

// ========== COMBINED AUDIO PLAYBACK WITH SEEKING ==========

// Combine all audio segments into a single playable audio with seek support
async function combineAudioSegments() {
    if (audiobookState.audioQueue.length === 0) {
        return null;
    }
    
    // Get sample rate from first segment
    const sampleRate = audiobookState.audioQueue[0].sampleRate || 24000;
    
    // Combine all PCM data
    let totalLength = 0;
    const pcmArrays = [];
    
    for (const segment of audiobookState.audioQueue) {
        const binaryString = atob(segment.audio);
        const len = binaryString.length;
        const pcmBuffer = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            pcmBuffer[i] = binaryString.charCodeAt(i) & 0xFF;
        }
        pcmArrays.push(pcmBuffer);
        totalLength += len;
        
        // Track approximate duration (16-bit mono)
        const duration = len / 2 / sampleRate;
        audioSegmentDurations.push(duration);
    }
    
    // Concatenate all PCM data
    const combinedPcm = new Uint8Array(totalLength);
    let offset = 0;
    for (const pcm of pcmArrays) {
        combinedPcm.set(pcm, offset);
        offset += pcm.length;
    }
    
    // Create WAV file
    const wavBuffer = createWavBufferFromPcm(combinedPcm, sampleRate);
    combinedAudioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
    combinedAudioUrl = URL.createObjectURL(combinedAudioBlob);
    
    return combinedAudioUrl;
}

// Create WAV buffer from PCM Uint8Array
function createWavBufferFromPcm(pcmData, sampleRate) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length;
    const bufferSize = 44 + dataSize;
    
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    
    // RIFF header
    writeStringToView(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStringToView(view, 8, 'WAVE');
    
    // fmt chunk
    writeStringToView(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    writeStringToView(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Copy PCM data
    const offset = 44;
    for (let i = 0; i < pcmData.length; i++) {
        view.setUint8(offset + i, pcmData[i]);
    }
    
    return buffer;
}

// Show full playback controls with seek bar and download
async function showFullPlaybackControls() {
    if (!audiobookPlayer) return;
    
    audiobookPlayer.style.display = 'block';
    
    // Combine audio segments
    updateStreamingStatus('Preparing audio for playback...');
    const audioUrl = await combineAudioSegments();
    
    if (!audioUrl) {
        audiobookPlayer.innerHTML = '<p>Error: No audio available</p>';
        return;
    }
    
    // Calculate total duration
    const totalDuration = audioSegmentDurations.reduce((a, b) => a + b, 0);
    
    let html = '<div class="audiobook-full-player">';
    
    // Audio element (hidden, controlled by custom UI)
    html += `<audio id="audiobook-combined-audio" src="${audioUrl}" preload="metadata"></audio>`;
    
    // Playback controls row
    html += '<div class="audiobook-controls-row">';
    html += '<button id="audiobook-rewind-btn" class="btn-icon" onclick="rewindAudiobook(10)" title="Rewind 10s">⏪</button>';
    html += '<button id="audiobook-play-full-btn" class="btn-primary" onclick="playFullAudiobook()">▶ Play</button>';
    html += '<button id="audiobook-pause-full-btn" class="btn-secondary" onclick="pauseFullAudiobook()" style="display:none;">⏸ Pause</button>';
    html += '<button id="audiobook-forward-btn" class="btn-icon" onclick="forwardAudiobook(10)" title="Forward 10s">⏩</button>';
    html += '<button class="btn-secondary" onclick="stopFullAudiobook()">⏹</button>';
    html += '</div>';
    
    // Progress bar with time display
    html += '<div class="audiobook-progress-row">';
    html += '<span id="audiobook-current-time">0:00</span>';
    html += '<div class="audiobook-seek-bar" onclick="seekAudiobook(event)" id="audiobook-seek-bar">';
    html += '<div class="audiobook-seek-progress" id="audiobook-seek-progress"></div>';
    html += '<div class="audiobook-seek-handle" id="audiobook-seek-handle"></div>';
    html += '</div>';
    html += '<span id="audiobook-total-time">' + formatTime(totalDuration) + '</span>';
    html += '</div>';
    
    // Segment info
    html += '<div class="audiobook-segment-info" id="audiobook-segment-info">';
    html += '<p>Select play to start listening</p>';
    html += '</div>';
    
    // Download button
    html += '<div class="audiobook-actions-row">';
    html += '<button class="btn-primary" onclick="downloadAudiobook()">⬇ Download Audiobook</button>';
    html += '<span id="audiobook-download-status"></span>';
    html += '</div>';
    
    html += '</div>';
    
    audiobookPlayer.innerHTML = html;
    
    // Set up audio element events
    combinedAudioElement = document.getElementById('audiobook-combined-audio');
    if (combinedAudioElement) {
        combinedAudioElement.addEventListener('timeupdate', updatePlaybackProgress);
        combinedAudioElement.addEventListener('loadedmetadata', () => {
            document.getElementById('audiobook-total-time').textContent = formatTime(combinedAudioElement.duration);
        });
        combinedAudioElement.addEventListener('ended', onAudiobookEnded);
        
        // Make seek bar draggable
        setupSeekBarDrag();
    }
}

// Play full combined audiobook
function playFullAudiobook() {
    if (!combinedAudioElement) return;
    
    combinedAudioElement.play();
    audiobookState.isPlaying = true;
    
    const playBtn = document.getElementById('audiobook-play-full-btn');
    const pauseBtn = document.getElementById('audiobook-pause-full-btn');
    if (playBtn) playBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
}

// Pause full combined audiobook
function pauseFullAudiobook() {
    if (!combinedAudioElement) return;
    
    combinedAudioElement.pause();
    audiobookState.isPlaying = false;
    
    const playBtn = document.getElementById('audiobook-play-full-btn');
    const pauseBtn = document.getElementById('audiobook-pause-full-btn');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
}

// Stop full combined audiobook
function stopFullAudiobook() {
    if (!combinedAudioElement) return;
    
    combinedAudioElement.pause();
    combinedAudioElement.currentTime = 0;
    audiobookState.isPlaying = false;
    
    const playBtn = document.getElementById('audiobook-play-full-btn');
    const pauseBtn = document.getElementById('audiobook-pause-full-btn');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    
    updatePlaybackProgress();
}

// Rewind audiobook by seconds
function rewindAudiobook(seconds) {
    if (!combinedAudioElement) return;
    combinedAudioElement.currentTime = Math.max(0, combinedAudioElement.currentTime - seconds);
}

// Forward audiobook by seconds
function forwardAudiobook(seconds) {
    if (!combinedAudioElement) return;
    combinedAudioElement.currentTime = Math.min(combinedAudioElement.duration, combinedAudioElement.currentTime + seconds);
}

// Seek to position from click
function seekAudiobook(event) {
    if (!combinedAudioElement) return;
    
    const seekBar = document.getElementById('audiobook-seek-bar');
    const rect = seekBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const newTime = percent * combinedAudioElement.duration;
    
    combinedAudioElement.currentTime = Math.max(0, Math.min(combinedAudioElement.duration, newTime));
    updatePlaybackProgress();
}

// Set up seek bar dragging
function setupSeekBarDrag() {
    const seekBar = document.getElementById('audiobook-seek-bar');
    const seekHandle = document.getElementById('audiobook-seek-handle');
    let isDragging = false;
    
    if (!seekBar || !seekHandle) return;
    
    const handleDrag = (e) => {
        if (!isDragging || !combinedAudioElement) return;
        
        const rect = seekBar.getBoundingClientRect();
        let percent;
        
        if (e.type.includes('touch')) {
            percent = (e.touches[0].clientX - rect.left) / rect.width;
        } else {
            percent = (e.clientX - rect.left) / rect.width;
        }
        
        percent = Math.max(0, Math.min(1, percent));
        const newTime = percent * combinedAudioElement.duration;
        
        combinedAudioElement.currentTime = newTime;
        updatePlaybackProgress();
    };
    
    seekHandle.addEventListener('mousedown', () => { isDragging = true; });
    seekHandle.addEventListener('touchstart', () => { isDragging = true; });
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('touchmove', handleDrag);
    
    document.addEventListener('mouseup', () => { isDragging = false; });
    document.addEventListener('touchend', () => { isDragging = false; });
    
    // Also allow clicking directly on seek bar
    seekBar.addEventListener('click', seekAudiobook);
}

// Update progress display
function updatePlaybackProgress() {
    if (!combinedAudioElement) return;
    
    const currentTime = combinedAudioElement.currentTime;
    const duration = combinedAudioElement.duration || 1;
    const percent = (currentTime / duration) * 100;
    
    // Update time display
    const currentTimeEl = document.getElementById('audiobook-current-time');
    if (currentTimeEl) {
        currentTimeEl.textContent = formatTime(currentTime);
    }
    
    // Update progress bar
    const progressEl = document.getElementById('audiobook-seek-progress');
    if (progressEl) {
        progressEl.style.width = `${percent}%`;
    }
    
    // Update handle position
    const handleEl = document.getElementById('audiobook-seek-handle');
    if (handleEl) {
        handleEl.style.left = `${percent}%`;
    }
    
    // Update segment info based on current time
    updateSegmentInfoForTime(currentTime);
}

// Update segment info based on current playback time
function updateSegmentInfoForTime(currentTime) {
    // Calculate which segment we're in based on accumulated durations
    let accumulatedTime = 0;
    let currentSegmentIndex = 0;
    
    for (let i = 0; i < audioSegmentDurations.length; i++) {
        if (currentTime < accumulatedTime + audioSegmentDurations[i]) {
            currentSegmentIndex = i;
            break;
        }
        accumulatedTime += audioSegmentDurations[i];
        currentSegmentIndex = i + 1;
    }
    
    if (currentSegmentIndex < audiobookState.audioQueue.length) {
        const segment = audiobookState.audioQueue[currentSegmentIndex];
        const infoEl = document.getElementById('audiobook-segment-info');
        if (infoEl && segment) {
            infoEl.innerHTML = `
                <p><strong>Speaker:</strong> ${segment.speaker || 'Unknown'}</p>
                <p><strong>Voice:</strong> ${segment.voiceUsed || 'Default'}</p>
                <p><strong>Text:</strong> ${segment.text || ''}</p>
            `;
        }
    }
}

// Called when audiobook ends
function onAudiobookEnded() {
    audiobookState.isPlaying = false;
    
    const playBtn = document.getElementById('audiobook-play-full-btn');
    const pauseBtn = document.getElementById('audiobook-pause-full-btn');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
}

// Download audiobook as WAV file
function downloadAudiobook() {
    if (!combinedAudioBlob) {
        alert('No audio available to download');
        return;
    }
    
    const statusEl = document.getElementById('audiobook-download-status');
    if (statusEl) statusEl.textContent = 'Preparing download...';
    
    // Create download link
    const url = URL.createObjectURL(combinedAudioBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'audiobook.wav';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Don't revoke URL immediately to allow download to complete
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
    
    if (statusEl) statusEl.textContent = 'Download started!';
    setTimeout(() => {
        if (statusEl) statusEl.textContent = '';
    }, 3000);
}

// Format time as M:SS
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Update progress bar
function updateProgress(percent, text) {
    if (audiobookProgressBar) {
        audiobookProgressBar.style.width = `${Math.max(0, percent)}%`;
    }
    if (audiobookProgressText) {
        audiobookProgressText.textContent = text;
    }
}

// Show audiobook player
function showAudiobookPlayer() {
    if (!audiobookPlayer) return;
    
    audiobookPlayer.style.display = 'block';
    
    // Create audio player controls
    let html = '<div class="audiobook-controls">';
    html += '<button id="audiobook-play-btn" class="btn-primary" onclick="playAudiobook()">▶ Play Audiobook</button>';
    html += '<button id="audiobook-pause-btn" class="btn-secondary" onclick="pauseAudiobook()" style="display:none;">⏸ Pause</button>';
    html += '<button class="btn-secondary" onclick="stopAudiobook()">⏹ Stop</button>';
    html += '<span id="audiobook-status">Ready to play</span>';
    html += '</div>';
    
    // Show segment info
    html += '<div class="audiobook-segment-info" id="audiobook-segment-info">';
    html += '<p>Click Play to start listening</p>';
    html += '</div>';
    
    audiobookPlayer.innerHTML = html;
}

// Play audiobook
let audioPlaybackIndex = 0;
let audiobookAudioElement = null;

async function playAudiobook() {
    if (audiobookState.audioQueue.length === 0) {
        alert('No audio generated yet');
        return;
    }
    
    audiobookState.isPlaying = true;
    audioPlaybackIndex = 0;
    
    const playBtn = document.getElementById('audiobook-play-btn');
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    if (playBtn) playBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-block';
    
    playNextAudioSegment();
}

// Play next audio segment
async function playNextAudioSegment() {
    if (!audiobookState.isPlaying || audioPlaybackIndex >= audiobookState.audioQueue.length) {
        stopAudiobook();
        return;
    }
    
    const segment = audiobookState.audioQueue[audioPlaybackIndex];
    
    // Update status
    const statusEl = document.getElementById('audiobook-status');
    const infoEl = document.getElementById('audiobook-segment-info');
    
    if (statusEl) {
        statusEl.textContent = `Playing ${audioPlaybackIndex + 1}/${audiobookState.audioQueue.length}`;
    }
    if (infoEl) {
        infoEl.innerHTML = `
            <p><strong>Speaker:</strong> ${segment.speaker || 'Unknown'}</p>
            <p><strong>Voice:</strong> ${segment.voiceUsed || 'Default'}</p>
            <p><strong>Text:</strong> ${segment.text || ''}</p>
        `;
    }
    
    // Create audio element
    try {
        // Convert raw PCM to WAV for playback
        const wavBuffer = createWavBufferFromBase64(segment.audio, segment.sampleRate);
        const blob = new Blob([wavBuffer], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(blob);
        
        if (audiobookAudioElement) {
            audiobookAudioElement.pause();
            URL.revokeObjectURL(audiobookAudioElement.src);
        }
        
        audiobookAudioElement = new Audio(audioUrl);
        
        audiobookAudioElement.onended = () => {
            URL.revokeObjectURL(audioUrl);
            audioPlaybackIndex++;
            if (audiobookState.isPlaying) {
                playNextAudioSegment();
            }
        };
        
        audiobookAudioElement.onerror = (e) => {
            console.error('Audio playback error:', e);
            URL.revokeObjectURL(audioUrl);
            audioPlaybackIndex++;
            if (audiobookState.isPlaying) {
                playNextAudioSegment();
            }
        };
        
        await audiobookAudioElement.play();
        
    } catch (error) {
        console.error('Error playing segment:', error);
        audioPlaybackIndex++;
        if (audiobookState.isPlaying) {
            playNextAudioSegment();
        }
    }
}

// Pause audiobook
function pauseAudiobook() {
    audiobookState.isPlaying = false;
    
    if (audiobookAudioElement) {
        audiobookAudioElement.pause();
    }
    
    const playBtn = document.getElementById('audiobook-play-btn');
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    
    const statusEl = document.getElementById('audiobook-status');
    if (statusEl) statusEl.textContent = 'Paused';
}

// Stop audiobook
function stopAudiobook() {
    audiobookState.isPlaying = false;
    audioPlaybackIndex = 0;
    
    if (audiobookAudioElement) {
        audiobookAudioElement.pause();
        audiobookAudioElement.currentTime = 0;
    }
    
    const playBtn = document.getElementById('audiobook-play-btn');
    const pauseBtn = document.getElementById('audiobook-pause-btn');
    if (playBtn) playBtn.style.display = 'inline-block';
    if (pauseBtn) pauseBtn.style.display = 'none';
    
    const statusEl = document.getElementById('audiobook-status');
    if (statusEl) statusEl.textContent = audiobookState.audioQueue.length > 0 ? 'Ready to play' : 'No audio';
}

// Create WAV buffer from base64 PCM data
function createWavBufferFromBase64(base64Pcm, sampleRate) {
    const binaryString = atob(base64Pcm);
    const len = binaryString.length;
    const pcmBuffer = new ArrayBuffer(len);
    const pcmView = new Uint8Array(pcmBuffer);
    for (let i = 0; i < len; i++) {
        pcmView[i] = binaryString.charCodeAt(i) & 0xFF;
    }
    
    // Create WAV container
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmBuffer.byteLength;
    const bufferSize = 44 + dataSize;
    
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);
    
    // RIFF header
    writeStringToView(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStringToView(view, 8, 'WAVE');
    
    // fmt chunk
    writeStringToView(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    writeStringToView(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Copy PCM data
    const offset = 44;
    for (let i = 0; i < pcmView.length; i++) {
        view.setUint8(offset + i, pcmView[i]);
    }
    
    return buffer;
}

function writeStringToView(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Export functions for global access
window.initAudiobook = initAudiobook;
window.openAudiobookModal = openAudiobookModal;
window.closeAudiobookModal = closeAudiobookModal;
window.updateVoiceMapping = updateVoiceMapping;
window.updateDefaultVoice = updateDefaultVoice;
window.playAudiobook = playAudiobook;
window.pauseAudiobook = pauseAudiobook;
window.stopAudiobook = stopAudiobook;
window.pauseStreamingAudio = pauseStreamingAudio;
window.resumeStreamingAudio = resumeStreamingAudio;
window.stopStreamingAudio = stopStreamingAudio;
window.playFullAudiobook = playFullAudiobook;
window.pauseFullAudiobook = pauseFullAudiobook;
window.stopFullAudiobook = stopFullAudiobook;
window.rewindAudiobook = rewindAudiobook;
window.forwardAudiobook = forwardAudiobook;
window.seekAudiobook = seekAudiobook;
window.downloadAudiobook = downloadAudiobook;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAudiobook);
} else {
    initAudiobook();
}

console.log('[AUDIOBOOK] audiobook.js loaded');
