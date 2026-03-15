import { VoiceEngine, VoiceState } from './voiceEngine.js?v=2';

let voiceEngine = null;
let voiceModeActive = false;
let newVoiceModeInitialized = false;

const VAD_SILENCE_THRESHOLD = 0.008;
const VAD_SILENCE_TIMEOUT = 400;
const MIN_SPEECH_DURATION = 0.3;

export function initNewVoiceMode() {
  if (newVoiceModeInitialized) return;
  newVoiceModeInitialized = true;
  
  const conversationToggle = document.getElementById('conversationToggle');
  const conversationControls = document.getElementById('conversationControls');
  const conversationStatus = document.getElementById('conversationStatus');
  const conversationStatusMessage = document.getElementById('conversationStatusMessage');
  const circleIndicator = document.getElementById('circleIndicator');
  const conversationMessages = document.getElementById('conversationMessages');
  const conversationInput = document.getElementById('conversationInput');
  const conversationMicBtn = document.getElementById('conversationMicBtn');
  const exitConversationBtn = document.getElementById('exitConversationBtn');
  const tapToTalkBtn = document.getElementById('tapToTalkBtn');
  
  if (!conversationToggle) {
    console.warn('[NewVoiceMode] conversationToggle not found');
    return;
  }

  conversationToggle.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!voiceModeActive) {
      window.useNewVoiceMode = true;
      await startNewVoiceMode();
    } else {
      await stopNewVoiceMode();
      window.useNewVoiceMode = false;
    }
  });

  if (exitConversationBtn) {
    exitConversationBtn.addEventListener('click', async () => {
      await stopNewVoiceMode();
    });
  }
}

async function startNewVoiceMode() {
  if (voiceModeActive && voiceEngine) {
    return;
  }

  console.log('[NewVoiceMode] Starting...');
  voiceModeActive = true;

  const conversationControls = document.getElementById('conversationControls');
  const conversationStatus = document.getElementById('conversationStatus');
  const conversationToggle = document.getElementById('conversationToggle');
  const conversationStatusMessage = document.getElementById('conversationStatusMessage');
  const circleIndicator = document.getElementById('circleIndicator');
  const conversationChatView = document.getElementById('conversationChatView');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const messagesContainer = document.getElementById('messagesContainer');

  if (conversationControls) {
    conversationControls.style.display = 'block';
  }

  if (conversationStatus) {
    conversationStatus.textContent = '🎙️ Voice Mode Active';
  }

  if (conversationToggle) {
    conversationToggle.classList.add('active');
  }

  if (conversationChatView) {
    conversationChatView.classList.add('active');
  }

  if (welcomeMessage) {
    welcomeMessage.classList.add('hidden');
  }

  if (messagesContainer) {
    messagesContainer.style.display = 'none';
  }

  if (circleIndicator) {
    circleIndicator.classList.add('active');
    const innerCircle = circleIndicator.querySelector('.circle-indicator');
    if (innerCircle) {
      innerCircle.classList.remove('idle', 'listening', 'speaking');
      innerCircle.classList.add('listening');
    }
  }

  if (conversationStatusMessage) {
    conversationStatusMessage.style.display = 'inline-block';
    conversationStatusMessage.textContent = 'Starting...';
    conversationStatusMessage.className = 'conversation-status-message listening';
  }

  const ttsSpeaker = document.getElementById('ttsSpeaker');
  const speaker = ttsSpeaker ? ttsSpeaker.value : 'default';

  voiceEngine = new VoiceEngine({
    speaker: speaker,
    onStateChange: handleStateChange,
    onTranscript: handleTranscript,
    onAIResponse: handleAIResponse,
    onError: handleError
  });

  try {
    await voiceEngine.start();
    updateUIState(VoiceState.LISTENING);
    console.log('[NewVoiceMode] Started successfully');
  } catch (error) {
    console.error('[NewVoiceMode] Failed to start:', error);
    await stopNewVoiceMode();
  }
}

async function stopNewVoiceMode() {
  console.log('[NewVoiceMode] Stopping...');
  voiceModeActive = false;

  if (voiceEngine) {
    voiceEngine.stop();
    voiceEngine = null;
  }

  const conversationControls = document.getElementById('conversationControls');
  const conversationStatus = document.getElementById('conversationStatus');
  const conversationToggle = document.getElementById('conversationToggle');
  const conversationStatusMessage = document.getElementById('conversationStatusMessage');
  const circleIndicator = document.getElementById('circleIndicator');
  const conversationChatView = document.getElementById('conversationChatView');
  const welcomeMessage = document.getElementById('welcomeMessage');
  const messagesContainer = document.getElementById('messagesContainer');

  if (conversationControls) {
    conversationControls.style.display = 'none';
  }

  if (conversationStatus) {
    conversationStatus.textContent = 'Voice Mode';
  }

  if (conversationToggle) {
    conversationToggle.classList.remove('active');
  }

  if (conversationChatView) {
    conversationChatView.classList.remove('active');
  }

  if (welcomeMessage) {
    welcomeMessage.classList.remove('hidden');
  }

  if (messagesContainer) {
    messagesContainer.style.display = 'flex';
  }

  if (circleIndicator) {
    circleIndicator.classList.remove('active');
    const innerCircle = circleIndicator.querySelector('.circle-indicator');
    if (innerCircle) {
      innerCircle.classList.remove('idle', 'listening', 'speaking');
    }
  }

  if (conversationStatusMessage) {
    conversationStatusMessage.style.display = 'none';
  }

  console.log('[NewVoiceMode] Stopped');
}

function handleStateChange(state) {
  console.log('[NewVoiceMode] State changed:', state);
  updateUIState(state);
}

function updateUIState(state) {
  const conversationStatusMessage = document.getElementById('conversationStatusMessage');
  const circleIndicator = document.getElementById('circleIndicator');
  const conversationMicBtn = document.getElementById('conversationMicBtn');
  const micBtn = document.getElementById('micBtn');

  if (circleIndicator) {
    const innerCircle = circleIndicator.querySelector('.circle-indicator');
    if (innerCircle) {
      innerCircle.classList.remove('idle', 'listening', 'speaking');
      
      switch (state) {
        case VoiceState.LISTENING:
        case VoiceState.IDLE:
          innerCircle.classList.add('idle');
          if (conversationStatusMessage) {
            conversationStatusMessage.textContent = '🎤 Ready to listen';
            conversationStatusMessage.className = 'conversation-status-message listening';
          }
          break;
        case VoiceState.USER_SPEAKING:
          innerCircle.classList.add('listening');
          if (conversationStatusMessage) {
            conversationStatusMessage.textContent = '🎤 Listening...';
            conversationStatusMessage.className = 'conversation-status-message listening';
          }
          break;
        case VoiceState.THINKING:
          innerCircle.classList.add('speaking');
          if (conversationStatusMessage) {
            conversationStatusMessage.textContent = '🤔 Thinking...';
            conversationStatusMessage.className = 'conversation-status-message speaking';
          }
          break;
        case VoiceState.AI_SPEAKING:
          innerCircle.classList.add('speaking');
          if (conversationStatusMessage) {
            conversationStatusMessage.textContent = '🔊 Speaking...';
            conversationStatusMessage.className = 'conversation-status-message speaking';
          }
          break;
        case VoiceState.INTERRUPTED:
          innerCircle.classList.add('listening');
          if (conversationStatusMessage) {
            conversationStatusMessage.textContent = '🎤 Interrupted - Listening...';
            conversationStatusMessage.className = 'conversation-status-message listening';
          }
          break;
      }
    }
  }

  if (conversationMicBtn) {
    conversationMicBtn.classList.toggle('recording', 
      state === VoiceState.USER_SPEAKING || state === VoiceState.LISTENING);
  }

  if (micBtn) {
    micBtn.classList.toggle('recording', 
      state === VoiceState.USER_SPEAKING || state === VoiceState.LISTENING);
  }
}

function handleTranscript(text) {
  const conversationInput = document.getElementById('conversationInput');
  if (conversationInput) {
    conversationInput.value = text;
  }
}

function handleAIResponse(text) {
  const conversationMessages = document.getElementById('conversationMessages');
  if (!conversationMessages) return;

  let lastMessage = conversationMessages.lastElementChild;
  
  if (!lastMessage || !lastMessage.classList.contains('ai')) {
    lastMessage = document.createElement('div');
    lastMessage.className = 'conversation-message ai';
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'conversation-message-avatar';
    avatarDiv.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9C5 11.38 6.19 13.47 8 14.74V17" stroke="currentColor" stroke-width="2"/><path d="M12 14.74C13.81 13.47 15 11.38 15 9C15 5.13 11.87 2 8 2" stroke="currentColor" stroke-width="2"/><path d="M12 17V21M8 23H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'conversation-message-content';
    contentDiv.textContent = text;
    
    lastMessage.appendChild(avatarDiv);
    lastMessage.appendChild(contentDiv);
    conversationMessages.appendChild(lastMessage);
  } else {
    const contentDiv = lastMessage.querySelector('.conversation-message-content');
    if (contentDiv) {
      contentDiv.textContent = text;
    }
  }

  conversationMessages.scrollTop = conversationMessages.scrollHeight;
}

function handleError(error) {
  console.error('[NewVoiceMode] Error:', error);
  
  const conversationStatusMessage = document.getElementById('conversationStatusMessage');
  if (conversationStatusMessage) {
    conversationStatusMessage.textContent = '❌ Error: ' + error.message;
    conversationStatusMessage.className = 'conversation-status-message error';
  }
}

export function isVoiceModeActive() {
  return voiceModeActive;
}

export function getVoiceEngine() {
  return voiceEngine;
}

export default {
  init: initNewVoiceMode,
  start: startNewVoiceMode,
  stop: stopNewVoiceMode,
  isActive: isVoiceModeActive,
  getEngine: getVoiceEngine
};

if (typeof window !== 'undefined') {
  window.NewVoiceMode = {
    init: initNewVoiceMode,
    start: startNewVoiceMode,
    stop: stopNewVoiceMode,
    isActive: isVoiceModeActive,
    getEngine: getVoiceEngine
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initNewVoiceMode, 100);
    });
  } else {
    setTimeout(initNewVoiceMode, 100);
  }
}