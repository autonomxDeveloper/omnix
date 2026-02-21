/**
 * LM Studio Chatbot - Core Module
 * DOM Elements, State, and Initialization
 */

// DOM Elements
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesContainer = document.getElementById('messages');
const chatContainer = document.getElementById('chatContainer');
const welcomeMessage = document.getElementById('welcomeMessage');
const typingIndicator = document.getElementById('typingIndicator');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const modelSelect = document.getElementById('modelSelect');
const clearBtn = document.getElementById('clearBtn');
const sidebar = document.getElementById('sidebar');
const sessionList = document.getElementById('sessionList');
const newChatBtn = document.getElementById('newChatBtn');
const toggleSidebarBtn = document.getElementById('toggleSidebar');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const systemPromptInput = document.getElementById('systemPrompt');
const globalSystemPromptInput = document.getElementById('globalSystemPrompt');
const saveSettings = document.getElementById('saveSettings');
const providerSelect = document.getElementById('providerSelect');
const lmstudioSettings = document.getElementById('lmstudioSettings');
const openrouterSettings = document.getElementById('openrouterSettings');
const lmstudioUrlInput = document.getElementById('lmstudioUrl');
const openrouterApiKeyInput = document.getElementById('openrouterApiKey');
const openrouterModelInput = document.getElementById('openrouterModel');
const openrouterContextInput = document.getElementById('openrouterContext');
const openrouterThinkingInput = document.getElementById('openrouterThinking');
const loadOpenRouterModelsBtn = document.getElementById('loadOpenRouterModels');
const ttsSpeaker = document.getElementById('ttsSpeaker');
const cerebrasApiKeyInput = document.getElementById('cerebrasApiKey');
const cerebrasModelInput = document.getElementById('cerebrasModel');
const cerebrasSettings = document.getElementById('cerebrasSettings');
const loadCerebrasModelsBtn = document.getElementById('loadCerebrasModels');

// State
let sessionId = null;
let isLoading = false;
let sessions = [];

// WebSocket Configuration
const WS_REALTIME_URL = "ws://localhost:8001/ws/voice";
const USE_WEBSOCKET = true; // Set to true for lower latency (requires realtime_server.py on port 8001)
const ENABLE_STREAMING_TTS = true; // Set to true for streaming TTS

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Page loaded, starting initialization...');
    console.log('Loading settings...');
    await loadSettings();
    console.log('Settings loaded, checking health...');
    checkHealth();
    console.log('Loading sessions...');
    loadSessions();
    console.log('Loading TTS speakers...');
    loadTTSSpeakers();
    console.log('Setting up event listeners...');
    setupEventListeners();
    console.log('Initialization complete!');
    setInterval(checkHealth, 30000);
});

// Setup event listeners
function setupEventListeners() {
    console.log('[CORE] Setting up event listeners...');
    
    // Use wrapper function to ensure sendMessage exists
    sendBtn.addEventListener('click', () => {
        console.log('[CORE] Send button clicked');
        if (typeof sendMessage === 'function') {
            sendMessage();
        } else {
            console.error('[CORE] sendMessage is not defined!');
        }
    });
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            console.log('[CORE] Enter pressed, message:', messageInput.value.trim());
            if (typeof sendMessage === 'function') {
                sendMessage();
            } else {
                console.error('[CORE] sendMessage is not defined!');
            }
        }
    });
    
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
        sendBtn.disabled = !messageInput.value.trim() || isLoading;
    });
    
    clearBtn.addEventListener('click', clearChat);
    modelSelect.addEventListener('change', () => {
        sessionStorage.setItem('selectedModel', modelSelect.value);
    });
    
    newChatBtn.addEventListener('click', createNewSession);
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    settingsBtn.addEventListener('click', () => {
        loadSettings();
        settingsModal.classList.add('active');
    });
    
    closeSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });
    
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('active');
        }
    });
    
    saveSettings.addEventListener('click', saveSettingsHandler);
    
    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        lmstudioSettings.style.display = provider === 'lmstudio' ? 'block' : 'none';
        openrouterSettings.style.display = provider === 'openrouter' ? 'block' : 'none';
        cerebrasSettings.style.display = provider === 'cerebras' ? 'block' : 'none';
    });
    
    loadOpenRouterModelsBtn.addEventListener('click', loadOpenRouterModels);
    
    if (loadCerebrasModelsBtn) {
        loadCerebrasModelsBtn.addEventListener('click', loadCerebrasModels);
    }
    
    // Save speaker selection when changed
    if (ttsSpeaker) {
        ttsSpeaker.addEventListener('change', () => {
            localStorage.setItem('selectedSpeaker', ttsSpeaker.value);
            console.log('[CORE] Saved speaker selection:', ttsSpeaker.value);
        });
    }
}

// Load settings
async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        console.log('Settings loaded:', data);
        
        if (data.success) {
            const settings = data.settings;
            providerSelect.value = settings.provider || 'cerebras';
            
            if (settings.lmstudio) {
                lmstudioUrlInput.value = settings.lmstudio.base_url || 'http://localhost:1234';
            }
            
            if (settings.openrouter) {
                const storedApiKey = settings.openrouter.api_key;
                if (storedApiKey && storedApiKey.length > 4) {
                    openrouterApiKeyInput.placeholder = '••••' + storedApiKey.slice(-4);
                } else if (storedApiKey) {
                    openrouterApiKeyInput.placeholder = 'API key saved';
                } else {
                    openrouterApiKeyInput.placeholder = 'sk-or-...';
                }
                openrouterModelInput.value = settings.openrouter.model || 'openai/gpt-4o-mini';
                openrouterContextInput.value = settings.openrouter.context_size || 128000;
                openrouterThinkingInput.value = settings.openrouter.thinking_budget || 0;
            }
            
            if (settings.cerebras) {
                if (cerebrasApiKeyInput) {
                    const storedApiKey = settings.cerebras.api_key;
                    if (storedApiKey && storedApiKey.length > 4) {
                        // Show masked key in the input field (first 8 chars + ...)
                        const maskedKey = storedApiKey.substring(0, 8) + '...' + storedApiKey.slice(-4);
                        cerebrasApiKeyInput.value = maskedKey;
                    } else if (storedApiKey) {
                        cerebrasApiKeyInput.placeholder = 'API key saved';
                    } else {
                        cerebrasApiKeyInput.placeholder = 'Get from cloud.cerebras.ai';
                    }
                }
                if (cerebrasModelInput) {
                    const savedModel = settings.cerebras.model || 'llama-3.3-70b-versatile';
                    let modelExists = false;
                    for (let i = 0; i < cerebrasModelInput.options.length; i++) {
                        if (cerebrasModelInput.options[i].value === savedModel) {
                            modelExists = true;
                            break;
                        }
                    }
                    if (!modelExists && savedModel) {
                        const option = document.createElement('option');
                        option.value = savedModel;
                        option.textContent = savedModel;
                        cerebrasModelInput.appendChild(option);
                    }
                    cerebrasModelInput.value = savedModel;
                }
            }
            
            const provider = providerSelect.value;
            lmstudioSettings.style.display = provider === 'lmstudio' ? 'block' : 'none';
            openrouterSettings.style.display = provider === 'openrouter' ? 'block' : 'none';
            if (cerebrasSettings) {
                cerebrasSettings.style.display = provider === 'cerebras' ? 'block' : 'none';
            }
            
            await loadModels();
            await checkHealth();
            
            if (globalSystemPromptInput && settings.global_system_prompt) {
                globalSystemPromptInput.value = settings.global_system_prompt;
            }
            
            loadSystemPrompt();
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

// Save settings
async function saveSettingsHandler() {
    const provider = providerSelect.value;
    
    let selectedModel = '';
    if (provider === 'cerebras' && cerebrasModelInput) {
        selectedModel = cerebrasModelInput.value.trim();
    } else if (provider === 'openrouter' && openrouterModelInput) {
        selectedModel = openrouterModelInput.value.trim();
    }
    
    let currentSettings = {};
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        if (data.success) {
            currentSettings = data.settings;
        }
    } catch (e) {
        console.error('Error fetching current settings:', e);
    }
    
    const openrouterKey = openrouterApiKeyInput.value.trim();
    const cerebrasKey = cerebrasApiKeyInput ? cerebrasApiKeyInput.value.trim() : '';
    
    // Check if the key is masked (contains "..." which means it wasn't changed)
    const isOpenRouterMasked = openrouterKey.includes('••••') || openrouterKey === '';
    const isCerebrasMasked = cerebrasKey.includes('...') || (cerebrasKey && cerebrasKey.length < 20);
    
    const settings = {
        provider: provider,
        global_system_prompt: globalSystemPromptInput ? globalSystemPromptInput.value : '',
        lmstudio: {
            base_url: lmstudioUrlInput.value
        },
        openrouter: {
            api_key: !isOpenRouterMasked ? openrouterKey : (currentSettings.openrouter?.api_key || ''),
            model: selectedModel || openrouterModelInput.value,
            context_size: parseInt(openrouterContextInput.value) || 128000,
            thinking_budget: parseInt(openrouterThinkingInput.value) || 0
        },
        cerebras: {
            api_key: !isCerebrasMasked ? cerebrasKey : (currentSettings.cerebras?.api_key || ''),
            model: selectedModel || 'llama-3.3-70b-versatile'
        }
    };
    
    console.log('Saving settings:', settings);
    await saveSystemPromptHandler();
    
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        if (!response.ok) {
            const text = await response.text();
            console.error('Server error:', response.status, text);
            alert('Error saving settings: ' + response.status);
            return;
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('Non-JSON response:', contentType);
            alert('Server returned an error. Make sure the chatbot server is running.');
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            settingsModal.classList.remove('active');
            
            if (provider === 'cerebras' && cerebrasModelInput && cerebrasModelInput.options.length > 0) {
                const cerebrasModels = [];
                for (let i = 0; i < cerebrasModelInput.options.length; i++) {
                    cerebrasModels.push(cerebrasModelInput.options[i].value);
                }
                
                modelSelect.innerHTML = '';
                cerebrasModels.forEach(m => {
                    const option = document.createElement('option');
                    option.value = m;
                    option.textContent = m;
                    modelSelect.appendChild(option);
                });
                
                if (selectedModel && cerebrasModels.includes(selectedModel)) {
                    modelSelect.value = selectedModel;
                } else if (cerebrasModels.length > 0) {
                    modelSelect.value = cerebrasModels[0];
                }
                
                console.log('Updated model dropdown with Cerebras models:', cerebrasModels);
            } else {
                await loadModels();
            }
            
            await checkHealth();
        } else {
            alert('Error: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        alert('Failed to connect to server. Make sure the chatbot is running.');
    }
}

// Load OpenRouter models
async function loadOpenRouterModels() {
    loadOpenRouterModelsBtn.textContent = 'Loading...';
    loadOpenRouterModelsBtn.disabled = true;
    
    const settings = {
        provider: 'openrouter',
        openrouter: {
            api_key: openrouterApiKeyInput.value,
            model: openrouterModelInput.value
        }
    };
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const response = await fetch('/api/openrouter/models');
        const data = await response.json();
        
        if (data.success && data.models) {
            openrouterModelInput.innerHTML = '';
            data.models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.id;
                option.textContent = m.name || m.id;
                openrouterModelInput.appendChild(option);
            });
        } else {
            alert('Error loading models: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error loading models: ' + error.message);
    } finally {
        loadOpenRouterModelsBtn.textContent = 'Load Models';
        loadOpenRouterModelsBtn.disabled = false;
    }
}

// Load Cerebras models
async function loadCerebrasModels() {
    if (!loadCerebrasModelsBtn) return;
    
    const apiKey = cerebrasApiKeyInput.value.trim();
    if (!apiKey) {
        alert('Please enter your Cerebras API key first');
        return;
    }
    
    loadCerebrasModelsBtn.textContent = 'Loading...';
    loadCerebrasModelsBtn.disabled = true;
    
    const settings = {
        provider: 'cerebras',
        cerebras: {
            api_key: apiKey,
            model: ''
        }
    };
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        const response = await fetch('/api/cerebras/models');
        const data = await response.json();
        
        if (data.success && data.models) {
            cerebrasModelInput.innerHTML = '';
            data.models.forEach(m => {
                const option = document.createElement('option');
                option.value = m.id;
                option.textContent = m.name || m.id;
                cerebrasModelInput.appendChild(option);
            });
            loadCerebrasModelsBtn.textContent = 'Models Loaded!';
        } else {
            alert('Error loading models: ' + (data.error || 'Unknown error'));
            loadCerebrasModelsBtn.textContent = 'Load Models';
        }
    } catch (error) {
        alert('Error loading models: ' + error.message);
        loadCerebrasModelsBtn.textContent = 'Load Models';
    } finally {
        loadCerebrasModelsBtn.disabled = false;
    }
}

// Load TTS speakers
async function loadTTSSpeakers() {
    try {
        const response = await fetch('/api/tts/speakers');
        const data = await response.json();
        
        if (data.success && data.speakers) {
            ttsSpeaker.innerHTML = '';
            
            data.speakers.forEach(speaker => {
                const option = document.createElement('option');
                option.value = speaker.id;
                option.textContent = speaker.name || speaker.id;
                ttsSpeaker.appendChild(option);
            });
            
            // Load saved speaker from localStorage, default to Maya for new users
            const savedSpeaker = localStorage.getItem('selectedSpeaker');
            if (savedSpeaker) {
                // Check if saved speaker exists in the list
                const speakerExists = data.speakers.some(s => s.id === savedSpeaker);
                if (speakerExists) {
                    ttsSpeaker.value = savedSpeaker;
                } else {
                    // Default to Maya if saved speaker doesn't exist
                    const mayaExists = data.speakers.some(s => s.id === 'Maya' || s.name === 'Maya');
                    ttsSpeaker.value = mayaExists ? 'Maya' : (data.speakers[0]?.id || '');
                }
            } else {
                // New user - default to Maya
                const mayaExists = data.speakers.some(s => s.id === 'Maya' || s.name === 'Maya');
                ttsSpeaker.value = mayaExists ? 'Maya' : (data.speakers[0]?.id || '');
            }
        }
    } catch (error) {
        console.error('Error loading TTS speakers:', error);
    }
}

// Check provider connection
async function checkHealth() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        
        if (data.status === 'connected') {
            statusDot.className = 'status-dot connected';
            if (data.provider === 'cerebras') {
                statusText.textContent = 'Cerebras';
            } else if (data.provider === 'openrouter') {
                statusText.textContent = 'OpenRouter';
            } else {
                statusText.textContent = 'Connected';
            }
            sendBtn.disabled = !messageInput.value.trim();
        } else {
            statusDot.className = 'status-dot disconnected';
            statusText.textContent = data.message || 'Disconnected';
            sendBtn.disabled = true;
        }
    } catch (error) {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Disconnected';
        sendBtn.disabled = true;
    }
}

// Load available models
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        
        modelSelect.innerHTML = '';
        
        if (data.success && data.models && data.models.length > 0) {
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelSelect.appendChild(option);
            });
            
            const currentModel = modelSelect.value;
            if (currentModel && data.models.includes(currentModel)) {
                modelSelect.value = currentModel;
            } else if (data.models.length > 0) {
                modelSelect.value = data.models[0];
            }
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No models available';
            modelSelect.appendChild(option);
        }
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
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
