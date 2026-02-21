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
const llamacppSettings = document.getElementById('llamacppSettings');
const llamacppUrlInput = document.getElementById('llamacppUrl');
const llamacppModelInput = document.getElementById('llamacppModel');
const huggingfaceTokenInput = document.getElementById('huggingfaceToken');
const hfTokenInput = document.getElementById('hfToken');

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
    
    // Load UI elements FIRST (no await - these are fast and make UI appear immediately)
    console.log('Setting up event listeners...');
    setupEventListeners();
    console.log('Loading sessions...');
    loadSessions();
    console.log('Loading TTS speakers...');
    loadTTSSpeakers();
    
    // Then load settings and check health in the background (don't block UI)
    console.log('Loading settings (in background)...');
    loadSettings().then(() => {
        console.log('Settings loaded, checking health...');
        checkHealth();
    }).catch(err => {
        console.error('Error loading settings:', err);
    });
    
    console.log('UI initialized, health check running in background...');
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
    
    // Sidebar logo button (in sidebar header) - shows collapse icon on hover
    const sidebarLogoBtn = document.getElementById('sidebarLogoBtn');
    if (sidebarLogoBtn) {
        sidebarLogoBtn.addEventListener('click', () => {
            // Toggle between collapsed and expanded
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.remove('collapsed');
            } else {
                sidebar.classList.add('collapsed');
            }
            updateSidebarButtons();
        });
    }
    
    // Sidebar collapse button (inside sidebar header) - collapses sidebar
    const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', () => {
            sidebar.classList.add('collapsed');
            updateSidebarButtons();
        });
    }
    
    // Expand sidebar button (floating) - expands sidebar when collapsed
    const expandSidebarBtn = document.getElementById('expandSidebarBtn');
    if (expandSidebarBtn) {
        expandSidebarBtn.addEventListener('click', () => {
            sidebar.classList.remove('collapsed');
            updateSidebarButtons();
        });
    }
    
    // Sidebar toggle button (in header) - expands sidebar when collapsed
    toggleSidebarBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        updateSidebarButtons();
    });
    
    // Update buttons visibility based on sidebar state
    function updateSidebarButtons() {
        const isCollapsed = sidebar.classList.contains('collapsed');
        
        // Show header toggle button only when collapsed (to expand)
        toggleSidebarBtn.style.display = isCollapsed ? 'flex' : 'none';
        
        // Show floating expand button when collapsed
        const expandSidebarBtn = document.getElementById('expandSidebarBtn');
        if (expandSidebarBtn) {
            expandSidebarBtn.style.display = isCollapsed ? 'flex' : 'none';
        }
        
        // Show sidebar logo button only when expanded (to collapse)
        if (sidebarLogoBtn) {
            sidebarLogoBtn.style.display = isCollapsed ? 'none' : 'flex';
        }
        
        // Show collapsed icons container only when collapsed
        const sidebarCollapsedIcons = document.getElementById('sidebarCollapsedIcons');
        if (sidebarCollapsedIcons) {
            sidebarCollapsedIcons.style.display = isCollapsed ? 'flex' : 'none';
        }
    }
    
    // Initialize - sidebar starts collapsed by CSS
    updateSidebarButtons();
    
    // New chat button in sidebar options
    const newChatBtnOption = document.getElementById('newChatBtnOption');
    if (newChatBtnOption) {
        newChatBtnOption.addEventListener('click', () => {
            createNewSession();
        });
    }
    
    // Search chat button in sidebar options
    const searchChatBtnOption = document.getElementById('searchChatBtnOption');
    const searchChatModal = document.getElementById('searchChatModal');
    const closeSearchChat = document.getElementById('closeSearchChat');
    const searchChatInput = document.getElementById('searchChatInput');
    const searchChatResults = document.getElementById('searchChatResults');
    
    if (searchChatBtnOption && searchChatModal) {
        searchChatBtnOption.addEventListener('click', () => {
            searchChatModal.classList.add('active');
            if (searchChatInput) {
                searchChatInput.value = '';
                searchChatInput.focus();
            }
            if (searchChatResults) {
                searchChatResults.innerHTML = '';
            }
        });
        
        if (closeSearchChat) {
            closeSearchChat.addEventListener('click', () => {
                searchChatModal.classList.remove('active');
            });
        }
        
        searchChatModal.addEventListener('click', (e) => {
            if (e.target === searchChatModal) {
                searchChatModal.classList.remove('active');
            }
        });
        
        // Search chat functionality
        if (searchChatInput) {
            searchChatInput.addEventListener('input', debounce(async () => {
                const query = searchChatInput.value.trim().toLowerCase();
                if (query.length < 2) {
                    if (searchChatResults) {
                        searchChatResults.innerHTML = '';
                    }
                    return;
                }
                
                await performChatSearch(query);
            }, 300));
        }
    }
    
    // Perform chat search
    async function performChatSearch(query) {
        if (!searchChatResults) return;
        
        try {
            const response = await fetch('/api/sessions');
            const data = await response.json();
            
            if (!data.success || !data.sessions) {
                searchChatResults.innerHTML = '<p class="search-chat-no-results">No sessions found</p>';
                return;
            }
            
            const results = [];
            
            // Fetch each session individually to get messages
            // The /api/sessions endpoint only returns metadata, not messages
            for (const session of data.sessions) {
                try {
                    const sessionResponse = await fetch(`/api/sessions/${session.id}`);
                    const sessionData = await sessionResponse.json();
                    
                    console.log('[SEARCH] Fetched session:', session.id, sessionData.success ? 'OK' : 'FAIL');
                    
                    if (sessionData.success && sessionData.session) {
                        const fullSession = sessionData.session;
                        // Add the session ID to the session object (API doesn't include it)
                        fullSession.id = session.id;
                        
                        console.log('[SEARCH] Session has messages:', fullSession.messages ? fullSession.messages.length : 0);
                        
                        // Check messages - search both user and AI messages
                        if (fullSession.messages) {
                            for (const msg of fullSession.messages) {
                                if (msg.content && msg.content.toLowerCase().includes(query)) {
                                    results.push({
                                        session: fullSession,
                                        type: 'message',
                                        match: msg.content,
                                        role: msg.role
                                    });
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error fetching session:', session.id, e);
                }
            }
            
            if (results.length === 0) {
                searchChatResults.innerHTML = '<p class="search-chat-no-results">No results found for "' + query + '"</p>';
                return;
            }
            
            // Display results
            console.log('[SEARCH] Building results for query:', query);
            searchChatResults.innerHTML = results.slice(0, 20).map(result => {
                const sessionTitle = result.session.title || 'Untitled Chat';
                const sessionId = result.session.id;
                let contentPreview = result.match;
                
                console.log('[SEARCH] Result session ID:', sessionId);
                
                // Truncate and highlight
                if (contentPreview.length > 150) {
                    const idx = contentPreview.toLowerCase().indexOf(query);
                    const start = Math.max(0, idx - 50);
                    const end = Math.min(contentPreview.length, idx + query.length + 100);
                    contentPreview = (start > 0 ? '...' : '') + 
                        contentPreview.substring(start, end).replace(
                            new RegExp('(' + query + ')', 'gi'), 
                            '<mark>$1</mark>'
                        ) + 
                        (end < contentPreview.length ? '...' : '');
                } else {
                    contentPreview = contentPreview.replace(
                        new RegExp('(' + query + ')', 'gi'), 
                        '<mark>$1</mark>'
                    );
                }
                
                return `
                    <div class="search-chat-result-item" data-session-id="${sessionId}">
                        <div class="search-chat-result-session">${sessionTitle} ${result.type === 'message' ? '- ' + (result.role || 'message') : ''}</div>
                        <div class="search-chat-result-content">${contentPreview}</div>
                    </div>
                `;
            }).join('');
            
            console.log('[SEARCH] HTML generated, checking data attributes');
            document.querySelectorAll('.search-chat-result-item').forEach((item, idx) => {
                console.log('[SEARCH] Item', idx, 'data-session-id:', item.getAttribute('data-session-id'), 'dataset.sessionId:', item.dataset.sessionId);
            });
            
            // Add click handlers to results
            document.querySelectorAll('.search-chat-result-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const targetSessionId = item.dataset.sessionId;
                    const searchText = query; // Store the search query for scrolling
                    
                    // Close search modal FIRST
                    searchChatModal.classList.remove('active');
                    
                    // Expand sidebar if collapsed (need to do this before switching)
                    sidebar.classList.remove('collapsed');
                    updateSidebarButtons();
                    
                    // Load the session FIRST and wait for it to complete
                    console.log('[SEARCH] Loading session:', targetSessionId);
                    
                    // Use loadSession directly to ensure it completes before scrolling
                    try {
                        console.log('[SEARCH] Fetching session from:', `/api/sessions/${targetSessionId}`);
                        const response = await fetch(`/api/sessions/${targetSessionId}`);
                        const data = await response.json();
                        
                        console.log('[SEARCH] Session response:', data);
                        
                        if (data.success && data.session) {
                            // Update global sessionId
                            sessionId = targetSessionId;
                            
                            // Render the messages
                            messagesContainer.innerHTML = '';
                            const messages = data.session.messages || [];
                            
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
                            
                            // Update system prompt if present
                            if (data.session.system_prompt) {
                                systemPromptInput.value = data.session.system_prompt;
                            }
                            
                            // Don't call loadSessions() here as it might reset the view
                            // The session list will be updated when user next interacts with sidebar
                            
                            console.log('[SEARCH] Session loaded, messages count:', messages.length);
                            
                            // NOW scroll to the message after session is fully loaded
                            setTimeout(() => {
                                const messageElements = messagesContainer.querySelectorAll('.message');
                                console.log('[SEARCH] Found', messageElements.length, 'message elements');
                                
                                let found = false;
                                for (let i = 0; i < messageElements.length; i++) {
                                    const msg = messageElements[i];
                                    const content = msg.querySelector('.message-content');
                                    const messageText = content ? content.textContent : msg.textContent;
                                    
                                    if (messageText && messageText.toLowerCase().includes(searchText.toLowerCase())) {
                                        console.log('[SEARCH] Found match in message', i);
                                        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        msg.style.backgroundColor = 'rgba(255, 255, 0, 0.3)';
                                        setTimeout(() => {
                                            msg.style.backgroundColor = '';
                                        }, 3000);
                                        found = true;
                                        break;
                                    }
                                }
                                
                                if (!found) {
                                    console.log('[SEARCH] No match, scrolling to bottom');
                                    chatContainer.scrollTop = chatContainer.scrollHeight;
                                }
                            }, 100);
                        } else {
                            console.error('[SEARCH] Failed to load session');
                        }
                    } catch (error) {
                        console.error('[SEARCH] Error loading session:', error);
                    }
                });
            });
            
        } catch (error) {
            console.error('Search error:', error);
            searchChatResults.innerHTML = '<p class="search-chat-no-results">Error performing search</p>';
        }
    }
    
    // Debounce utility
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Keep original newChatBtn for compatibility
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', createNewSession);
    }
    
    // New collapsed sidebar buttons
    const newChatBtnCollapsed = document.getElementById('newChatBtnCollapsed');
    if (newChatBtnCollapsed) {
        newChatBtnCollapsed.addEventListener('click', () => {
            createNewSession();
        });
    }
    
    const searchChatBtnCollapsed = document.getElementById('searchChatBtnCollapsed');
    if (searchChatBtnCollapsed && searchChatModal) {
        searchChatBtnCollapsed.addEventListener('click', () => {
            searchChatModal.classList.add('active');
            if (searchChatInput) {
                searchChatInput.value = '';
                searchChatInput.focus();
            }
            if (searchChatResults) {
                searchChatResults.innerHTML = '';
            }
        });
    }
    
    // Voice Clone button in collapsed sidebar
    const voiceCloneBtnCollapsed = document.getElementById('voiceCloneBtnCollapsed');
    if (voiceCloneBtnCollapsed) {
        voiceCloneBtnCollapsed.addEventListener('click', () => {
            // Open voice clone modal - use the header button handler
            const voiceCloneModal = document.getElementById('voiceCloneModal');
            if (voiceCloneModal) {
                voiceCloneModal.classList.add('active');
            }
        });
    }
    
    // Audiobook button in collapsed sidebar
    const audiobookBtnCollapsed = document.getElementById('audiobookBtnCollapsed');
    if (audiobookBtnCollapsed) {
        audiobookBtnCollapsed.addEventListener('click', () => {
            // Open audiobook modal
            const audiobookModal = document.getElementById('audiobook-modal');
            if (audiobookModal) {
                audiobookModal.classList.add('active');
            }
        });
    }
    
    // Podcast button in collapsed sidebar
    const podcastBtnCollapsed = document.getElementById('podcastBtnCollapsed');
    if (podcastBtnCollapsed) {
        podcastBtnCollapsed.addEventListener('click', () => {
            // Open podcast modal
            const podcastModal = document.getElementById('podcast-modal');
            if (podcastModal) {
                podcastModal.classList.add('active');
            }
        });
    }
    
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
        llamacppSettings.style.display = provider === 'llamacpp' ? 'block' : 'none';
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
            if (llamacppSettings) {
                llamacppSettings.style.display = provider === 'llamacpp' ? 'block' : 'none';
            }
            
            // Load llama.cpp settings if present
            if (settings.llamacpp) {
                if (llamacppUrlInput) {
                    llamacppUrlInput.value = settings.llamacpp.base_url || 'http://localhost:8080';
                }
                if (llamacppModelInput) {
                    llamacppModelInput.value = settings.llamacpp.model || '';
                }
            }
            
            // Load HuggingFace token if present
            if (settings.huggingface) {
                if (huggingfaceTokenInput && settings.huggingface.token) {
                    // Mask the token in the input field
                    const token = settings.huggingface.token;
                    if (token.length > 8) {
                        huggingfaceTokenInput.value = token.substring(0, 4) + '...' + token.slice(-4);
                    } else {
                        huggingfaceTokenInput.value = 'hf_***';
                    }
                }
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
    
    // Get HF token from settings modal (huggingfaceTokenInput) or LLM Model Manager (hfTokenInput)
    let hfTokenValue = '';
    if (huggingfaceTokenInput) {
        hfTokenValue = huggingfaceTokenInput.value.trim();
    }
    // Also check LLM Model Manager's hfToken if available
    if (!hfTokenValue && hfTokenInput) {
        hfTokenValue = hfTokenInput.value.trim();
    }
    
    const isHfTokenMasked = hfTokenValue.includes('...') || hfTokenValue === '' || hfTokenValue === 'hf_***';
    
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
        },
        llamacpp: {
            base_url: llamacppUrlInput ? llamacppUrlInput.value : 'http://localhost:8080',
            model: llamacppModelInput ? llamacppModelInput.value : ''
        },
        huggingface: {
            token: !isHfTokenMasked ? hfTokenValue : (currentSettings.huggingface?.token || '')
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

// ==================== LLM MODEL MANAGER ====================

// LLM Model Manager DOM Elements
const llmModelBtn = document.getElementById('llmModelBtn');
const llmModelModal = document.getElementById('llmModelModal');
const closeLlmModel = document.getElementById('closeLlmModel');
const modelDownloadUrl = document.getElementById('modelDownloadUrl');
const modelPageUrl = document.getElementById('modelPageUrl');
const fetchFilesBtn = document.getElementById('fetchFilesBtn');
const ggufFilesGroup = document.getElementById('ggufFilesGroup');
const ggufFilesSelect = document.getElementById('ggufFilesSelect');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
const startDownloadBtn = document.getElementById('startDownloadBtn');
const downloadProgress = document.getElementById('downloadProgress');
const downloadFilename = document.getElementById('downloadFilename');
const downloadStatus = document.getElementById('downloadStatus');
const downloadProgressBar = document.getElementById('downloadProgressBar');
const downloadSpeed = document.getElementById('downloadSpeed');
const downloadEta = document.getElementById('downloadEta');
const downloadPercent = document.getElementById('downloadPercent');
const pauseDownloadBtn = document.getElementById('pauseDownloadBtn');
const resumeDownloadBtn = document.getElementById('resumeDownloadBtn');
const stopDownloadBtn = document.getElementById('stopDownloadBtn');
const llmModelsList = document.getElementById('llmModelsList');

// Store fetched files for download
let fetchedGgufFiles = [];

// Download state
let currentDownloadId = null;
let downloadStatusInterval = null;

// Fetch files from HuggingFace model page
if (fetchFilesBtn) {
    fetchFilesBtn.addEventListener('click', async () => {
        const url = modelPageUrl.value.trim();
        
        if (!url) {
            alert('Please enter a HuggingFace model page URL');
            return;
        }
        
        // Basic URL validation
        if (!url.includes('huggingface.co')) {
            alert('Please enter a valid HuggingFace URL (e.g., https://huggingface.co/ggml-org/Devstral-Small-2-24B-Instruct-2512-GGUF)');
            return;
        }
        
        fetchFilesBtn.disabled = true;
        fetchFilesBtn.textContent = 'Fetching...';
        
        try {
            const response = await fetch('/api/llm/huggingface/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model_url: url })
            });
            
            const data = await response.json();
            
            if (data.success) {
                fetchedGgufFiles = data.files || [];
                
                if (fetchedGgufFiles.length === 0) {
                    alert('No GGUF files found for this model.');
                    ggufFilesGroup.style.display = 'none';
                    return;
                }
                
                // Populate dropdown
                ggufFilesSelect.innerHTML = '<option value="">-- Select a file to download --</option>';
                
                fetchedGgufFiles.forEach((file, index) => {
                    const option = document.createElement('option');
                    option.value = index;  // Use index to reference the file
                    option.textContent = `${file.name} (${file.size_formatted})`;
                    ggufFilesSelect.appendChild(option);
                });
                
                // Show the dropdown
                ggufFilesGroup.style.display = 'block';
            } else {
                alert('Error fetching files: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error fetching files:', error);
            alert('Error fetching files. Make sure the URL is correct.');
        } finally {
            fetchFilesBtn.disabled = false;
            fetchFilesBtn.textContent = 'Fetch Files';
        }
    });
}

// Download selected file from dropdown
if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener('click', async () => {
        const selectedIndex = ggufFilesSelect.value;
        
        if (selectedIndex === '') {
            alert('Please select a file to download');
            return;
        }
        
        const file = fetchedGgufFiles[selectedIndex];
        if (!file || !file.download_url) {
            alert('Invalid file selection');
            return;
        }
        
        downloadSelectedBtn.disabled = true;
        downloadSelectedBtn.textContent = 'Starting...';
        
        try {
            const response = await fetch('/api/llm/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: file.download_url })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentDownloadId = data.download_id;
                downloadProgress.style.display = 'block';
                downloadFilename.textContent = data.filename;
                downloadStatus.textContent = 'Starting...';
                downloadProgressBar.style.width = '0%';
                downloadPercent.textContent = '0%';
                downloadSpeed.textContent = '0 MB/s';
                downloadEta.textContent = '--:--';
                
                // Start polling for status
                downloadStatusInterval = setInterval(updateDownloadStatus, 1000);
            } else {
                alert('Error starting download: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error starting download:', error);
            alert('Error starting download');
        } finally {
            downloadSelectedBtn.disabled = false;
            downloadSelectedBtn.textContent = 'Download Selected';
        }
    });
}

// Setup LLM Model Manager
if (llmModelBtn) {
    llmModelBtn.addEventListener('click', () => {
        llmModelModal.classList.add('active');
        loadLlmModels();
    });
}

if (closeLlmModel) {
    closeLlmModel.addEventListener('click', () => {
        llmModelModal.classList.remove('active');
    });
}

if (llmModelModal) {
    llmModelModal.addEventListener('click', (e) => {
        if (e.target === llmModelModal) {
            llmModelModal.classList.remove('active');
        }
    });
}

// Load LLM models list
async function loadLlmModels() {
    try {
        const response = await fetch('/api/llm/models');
        const data = await response.json();
        
        if (data.success && data.models) {
            if (data.models.length === 0) {
                llmModelsList.innerHTML = '<p style="color: var(--text-muted);">No models installed. Download a GGUF model to get started.</p>';
            } else {
                llmModelsList.innerHTML = '';
                data.models.forEach(model => {
                    const modelItem = document.createElement('div');
                    modelItem.className = 'llm-model-item';
                    modelItem.innerHTML = `
                        <div class="model-info">
                            <span class="model-name">${model.name}</span>
                            <span class="model-size">${model.size_formatted}</span>
                        </div>
                        <button class="delete-model-btn" onclick="deleteLlmModel('${model.name}')" title="Delete model">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                                <path d="M3 6H5H21" stroke="currentColor" stroke-width="2"/>
                                <path d="M19 6V20C19 21 18 22 17 22H7C6 22 5 21 5 20V6" stroke="currentColor" stroke-width="2"/>
                            </svg>
                        </button>
                    `;
                    llmModelsList.appendChild(modelItem);
                });
            }
        } else {
            llmModelsList.innerHTML = '<p style="color: var(--text-muted);">Error loading models.</p>';
        }
    } catch (error) {
        console.error('Error loading LLM models:', error);
        llmModelsList.innerHTML = '<p style="color: var(--text-muted);">Error loading models.</p>';
    }
}

// Delete LLM model
async function deleteLlmModel(filename) {
    if (!confirm(`Delete model "${filename}"? This cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/llm/models/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            loadLlmModels();
        } else {
            alert('Error deleting model: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting model:', error);
        alert('Error deleting model');
    }
}

// Start download
if (startDownloadBtn) {
    startDownloadBtn.addEventListener('click', async () => {
        const url = modelDownloadUrl.value.trim();
        
        if (!url) {
            alert('Please enter a HuggingFace download URL');
            return;
        }
        
        startDownloadBtn.disabled = true;
        startDownloadBtn.textContent = 'Starting...';
        
        try {
            const response = await fetch('/api/llm/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            
            const data = await response.json();
            
            if (data.success) {
                currentDownloadId = data.download_id;
                downloadProgress.style.display = 'block';
                downloadFilename.textContent = data.filename;
                downloadStatus.textContent = 'Starting...';
                downloadProgressBar.style.width = '0%';
                downloadPercent.textContent = '0%';
                downloadSpeed.textContent = '0 MB/s';
                downloadEta.textContent = '--:--';
                
                // Start polling for status
                downloadStatusInterval = setInterval(updateDownloadStatus, 1000);
            } else {
                alert('Error starting download: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error starting download:', error);
            alert('Error starting download');
        } finally {
            startDownloadBtn.disabled = false;
            startDownloadBtn.textContent = 'Download Model';
        }
    });
}

// Update download status
async function updateDownloadStatus() {
    if (!currentDownloadId) return;
    
    try {
        const response = await fetch(`/api/llm/download/status?id=${currentDownloadId}`);
        const data = await response.json();
        
        if (data.success && data.download) {
            const download = data.download;
            
            downloadFilename.textContent = download.filename;
            downloadProgressBar.style.width = download.progress + '%';
            downloadPercent.textContent = download.progress + '%';
            
            // Update status text
            const statusMap = {
                'starting': 'Starting...',
                'downloading': 'Downloading...',
                'paused': 'Paused',
                'completed': 'Completed!',
                'error': 'Error: ' + (download.error || 'Unknown'),
                'cancelled': 'Cancelled'
            };
            downloadStatus.textContent = statusMap[download.status] || download.status;
            
            // Update speed and ETA
            if (download.speed !== undefined && download.speed !== null) {
                const speedMB = download.speed / (1024 * 1024);
                downloadSpeed.textContent = speedMB.toFixed(2) + ' MB/s';
            }
            
            if (download.eta !== undefined && download.eta !== null && !isNaN(download.eta)) {
                const etaSeconds = Math.round(download.eta);
                const mins = Math.floor(etaSeconds / 60);
                const secs = etaSeconds % 60;
                downloadEta.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            
            // Update button states
            if (download.status === 'paused') {
                pauseDownloadBtn.style.display = 'none';
                resumeDownloadBtn.style.display = 'inline-block';
            } else if (download.status === 'downloading') {
                pauseDownloadBtn.style.display = 'inline-block';
                resumeDownloadBtn.style.display = 'none';
            }
            
            // Handle completion
            if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
                clearInterval(downloadStatusInterval);
                
                if (download.status === 'completed') {
                    setTimeout(() => {
                        alert('Download completed successfully!');
                        downloadProgress.style.display = 'none';
                        modelDownloadUrl.value = '';
                        loadLlmModels();
                    }, 500);
                } else if (download.status === 'error') {
                    setTimeout(() => {
                        alert('Download error: ' + (download.error || 'Unknown error'));
                        downloadProgress.style.display = 'none';
                    }, 500);
                }
            }
        }
    } catch (error) {
        console.error('Error updating download status:', error);
    }
}

// Pause download
if (pauseDownloadBtn) {
    pauseDownloadBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/llm/download/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: currentDownloadId })
            });
        } catch (error) {
            console.error('Error pausing download:', error);
        }
    });
}

// Resume download
if (resumeDownloadBtn) {
    resumeDownloadBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/llm/download/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: currentDownloadId })
            });
        } catch (error) {
            console.error('Error resuming download:', error);
        }
    });
}

// Stop download
if (stopDownloadBtn) {
    stopDownloadBtn.addEventListener('click', async () => {
        if (!confirm('Stop download? The partial file will be deleted.')) {
            return;
        }
        
        try {
            await fetch('/api/llm/download/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: currentDownloadId })
            });
            
            clearInterval(downloadStatusInterval);
            downloadProgress.style.display = 'none';
            currentDownloadId = null;
        } catch (error) {
            console.error('Error stopping download:', error);
        }
    });
}

// ==================== LLAMA.CPP SETTINGS MODEL LOADING ====================

// llama.cpp Settings DOM Elements
const llamacppDownloadUrl = document.getElementById('llamacppDownloadUrl');
const llamacppDownloadBtn = document.getElementById('llamacppDownloadBtn');
const llamacppDownloadProgress = document.getElementById('llamacppDownloadProgress');
const llamacppDownloadFilename = document.getElementById('llamacppDownloadFilename');
const llamacppDownloadStatus = document.getElementById('llamacppDownloadStatus');
const llamacppDownloadProgressBar = document.getElementById('llamacppDownloadProgressBar');
const llamacppDownloadSpeed = document.getElementById('llamacppDownloadSpeed');
const llamacppDownloadEta = document.getElementById('llamacppDownloadEta');
const llamacppDownloadPercent = document.getElementById('llamacppDownloadPercent');
const llamacppPauseDownloadBtn = document.getElementById('llamacppPauseDownloadBtn');
const llamacppResumeDownloadBtn = document.getElementById('llamacppResumeDownloadBtn');
const llamacppStopDownloadBtn = document.getElementById('llamacppStopDownloadBtn');

// llama.cpp download state
let llamacppCurrentDownloadId = null;
let llamacppDownloadStatusInterval = null;

// Load LLM models into llama.cpp dropdown
async function loadLlmModelsForLlamaCpp() {
    try {
        const response = await fetch('/api/llm/models');
        const data = await response.json();
        
        if (data.success && data.models) {
            // Clear existing options except first
            llamacppModelInput.innerHTML = '<option value="">-- Select a model --</option>';
            
            data.models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = `${model.name} (${model.size_formatted})`;
                llamacppModelInput.appendChild(option);
            });
            
            // Load saved model from settings
            const settingsResponse = await fetch('/api/settings');
            const settingsData = await settingsResponse.json();
            if (settingsData.success && settingsData.settings.llamacpp?.model) {
                llamacppModelInput.value = settingsData.settings.llamacpp.model;
            }
        }
    } catch (error) {
        console.error('Error loading LLM models for llama.cpp:', error);
    }
}

// Setup llama.cpp download
if (llamacppDownloadBtn) {
    llamacppDownloadBtn.addEventListener('click', async () => {
        const url = llamacppDownloadUrl.value.trim();
        
        if (!url) {
            alert('Please enter a HuggingFace download URL');
            return;
        }
        
        llamacppDownloadBtn.disabled = true;
        llamacppDownloadBtn.textContent = 'Starting...';
        
        try {
            const response = await fetch('/api/llm/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });
            
            const data = await response.json();
            
            if (data.success) {
                llamacppCurrentDownloadId = data.download_id;
                llamacppDownloadProgress.style.display = 'block';
                llamacppDownloadFilename.textContent = data.filename;
                llamacppDownloadStatus.textContent = 'Starting...';
                llamacppDownloadProgressBar.style.width = '0%';
                llamacppDownloadPercent.textContent = '0%';
                llamacppDownloadSpeed.textContent = '0 MB/s';
                llamacppDownloadEta.textContent = '--:--';
                
                // Start polling for status
                llamacppDownloadStatusInterval = setInterval(updateLlamaCppDownloadStatus, 1000);
            } else {
                alert('Error starting download: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error starting download:', error);
            alert('Error starting download');
        } finally {
            llamacppDownloadBtn.disabled = false;
            llamacppDownloadBtn.textContent = 'Download Model';
        }
    });
}

// Update llama.cpp download status
async function updateLlamaCppDownloadStatus() {
    if (!llamacppCurrentDownloadId) return;
    
    try {
        const response = await fetch(`/api/llm/download/status?id=${llamacppCurrentDownloadId}`);
        const data = await response.json();
        
        if (data.success && data.download) {
            const download = data.download;
            
            llamacppDownloadFilename.textContent = download.filename;
            llamacppDownloadProgressBar.style.width = download.progress + '%';
            llamacppDownloadPercent.textContent = download.progress + '%';
            
            // Update status text
            const statusMap = {
                'starting': 'Starting...',
                'downloading': 'Downloading...',
                'paused': 'Paused',
                'completed': 'Completed!',
                'error': 'Error: ' + (download.error || 'Unknown'),
                'cancelled': 'Cancelled'
            };
            llamacppDownloadStatus.textContent = statusMap[download.status] || download.status;
            
            // Update speed and ETA
            if (download.speed !== undefined && download.speed !== null) {
                const speedMB = download.speed / (1024 * 1024);
                llamacppDownloadSpeed.textContent = speedMB.toFixed(2) + ' MB/s';
            }
            
            if (download.eta !== undefined && download.eta !== null && !isNaN(download.eta)) {
                const etaSeconds = Math.round(download.eta);
                const mins = Math.floor(etaSeconds / 60);
                const secs = etaSeconds % 60;
                llamacppDownloadEta.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
            
            // Update button states
            if (download.status === 'paused') {
                llamacppPauseDownloadBtn.style.display = 'none';
                llamacppResumeDownloadBtn.style.display = 'inline-block';
            } else if (download.status === 'downloading') {
                llamacppPauseDownloadBtn.style.display = 'inline-block';
                llamacppResumeDownloadBtn.style.display = 'none';
            }
            
            // Handle completion
            if (download.status === 'completed' || download.status === 'error' || download.status === 'cancelled') {
                clearInterval(llamacppDownloadStatusInterval);
                
                if (download.status === 'completed') {
                    setTimeout(() => {
                        alert('Download completed successfully!');
                        llamacppDownloadProgress.style.display = 'none';
                        llamacppDownloadUrl.value = '';
                        loadLlmModelsForLlamaCpp();
                    }, 500);
                } else if (download.status === 'error') {
                    setTimeout(() => {
                        alert('Download error: ' + (download.error || 'Unknown error'));
                        llamacppDownloadProgress.style.display = 'none';
                    }, 500);
                }
            }
        }
    } catch (error) {
        console.error('Error updating llama.cpp download status:', error);
    }
}

// Pause llama.cpp download
if (llamacppPauseDownloadBtn) {
    llamacppPauseDownloadBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/llm/download/pause', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: llamacppCurrentDownloadId })
            });
        } catch (error) {
            console.error('Error pausing download:', error);
        }
    });
}

// Resume llama.cpp download
if (llamacppResumeDownloadBtn) {
    llamacppResumeDownloadBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/llm/download/resume', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: llamacppCurrentDownloadId })
            });
        } catch (error) {
            console.error('Error resuming download:', error);
        }
    });
}

// Stop llama.cpp download
if (llamacppStopDownloadBtn) {
    llamacppStopDownloadBtn.addEventListener('click', async () => {
        if (!confirm('Stop download? The partial file will be deleted.')) {
            return;
        }
        
        try {
            await fetch('/api/llm/download/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ download_id: llamacppCurrentDownloadId })
            });
            
            clearInterval(llamacppDownloadStatusInterval);
            llamacppDownloadProgress.style.display = 'none';
            llamacppCurrentDownloadId = null;
        } catch (error) {
            console.error('Error stopping download:', error);
        }
    });
}

// Load LLM models when settings modal opens with llama.cpp provider
const originalLoadSettings = loadSettings;
loadSettings = async function() {
    await originalLoadSettings();
    
    // Load LLM models for llama.cpp dropdown when provider is llama.cpp
    if (providerSelect && providerSelect.value === 'llamacpp') {
        loadLlmModelsForLlamaCpp();
    }
};

// Also load on provider change to llama.cpp
if (providerSelect) {
    providerSelect.addEventListener('change', () => {
        if (providerSelect.value === 'llamacpp') {
            loadLlmModelsForLlamaCpp();
        }
    });
}
