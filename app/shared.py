import os
import json
import re
from typing import Optional, Dict, Any, List

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)

SESSIONS_FILE = os.path.join(DATA_DIR, 'sessions.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
VOICE_CLONES_FILE = os.path.join(DATA_DIR, 'voice_clones.json')

# Create necessary directories
os.makedirs(os.path.join(BASE_DIR, 'models', 'llm'), exist_ok=True)
os.makedirs(os.path.join(BASE_DIR, 'models', 'server'), exist_ok=True)

# Shared Service Constants
TTS_BASE_URL = "http://localhost:8020"
TTS_SAMPLE_RATE = 24000
STT_BASE_URL = "http://localhost:8000"

# Global Shared States
sessions_data = {}
custom_voices = {}
downloads = {}
llamacpp_server_downloads = {}

# Provider system
from app.providers import get_registry, BaseProvider, ProviderConfig

DEFAULT_SETTINGS = {
    "provider": "lmstudio",
    "global_system_prompt": """You are an intelligent conversational AI designed for natural, engaging dialogue. Respond in a clear, friendly, and human-like manner while remaining concise and coherent. Prioritize understanding the user's intent and replying directly, without unnecessary elaboration or filler. Keep responses focused and easy to follow, using natural phrasing rather than formal or technical language unless required. Maintain conversational flow across turns and adapt smoothly to the user's tone. Default to brevity and do not exceed five sentences unless the user explicitly asks for more detail.""",
    "lmstudio": {"base_url": "http://localhost:1234"},
    "openrouter": {"api_key": "", "model": "openai/gpt-4o-mini", "context_size": 128000, "thinking_budget": 0},
    "cerebras": {"api_key": "", "model": "llama-3.3-70b-versatile"},
    "llamacpp": {"base_url": "http://localhost:8080", "model": "", "download_location": "server", "auto_start": False}
}

DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant."

def migrate_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """
    Migrate old settings format to new provider-based format.
    
    Args:
        settings: Old settings dictionary
        
    Returns:
        Migrated settings dictionary
    """
    # Check if already migrated (has provider-specific configs at top level)
    if 'provider' in settings and any(key in settings for key in ['lmstudio', 'openrouter', 'cerebras', 'llamacpp']):
        # Already in new format or mixed - ensure all provider configs exist
        for key in ['cerebras', 'openrouter', 'lmstudio', 'llamacpp']:
            if key not in settings:
                settings[key] = DEFAULT_SETTINGS[key].copy()
        return settings
    
    # Old format - migrate
    migrated = settings.copy()
    
    # Ensure provider key exists
    if 'provider' not in migrated:
        migrated['provider'] = 'lmstudio'
    
    # Initialize provider configs if not present
    for key in ['cerebras', 'openrouter', 'lmstudio', 'llamacpp']:
        if key not in migrated:
            migrated[key] = DEFAULT_SETTINGS[key].copy()
    
    # Migrate old base_url to lmstudio config
    if 'base_url' in migrated:
        migrated['lmstudio']['base_url'] = migrated.pop('base_url')
    
    return migrated

def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
                # Migrate old settings format
                settings = migrate_settings(settings)
                # Ensure all provider configs exist
                for key in ['cerebras', 'openrouter', 'lmstudio', 'llamacpp']:
                    if key not in settings:
                        settings[key] = DEFAULT_SETTINGS[key].copy()
                return settings
        except Exception as e:
            print(f"Error loading settings: {e}, using defaults")
    return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=2)

def load_sessions():
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, 'r') as f:
                return json.load(f)
        except: pass
    return {}

def save_sessions(sessions):
    with open(SESSIONS_FILE, 'w') as f:
        json.dump(sessions, f, indent=2)

def extract_thinking(content):
    """Extract thinking/analysis from content."""
    if not content:
        return "", content
    
    lines = content.split('\n')
    thinking_lines, answer_lines = [], []
    found_thinking = False
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        # Check for numbered list indicators (1., 2., etc.)
        if stripped and all(stripped.startswith(f"{n}.") for n in range(1, 10) if stripped.startswith(f"{n}.")):
            if not found_thinking and i > 0 and any(m in '\n'.join(lines[:i]).lower() for m in ['analyze', 'identify', 'determine']):
                thinking_lines, answer_lines = lines[:i], lines[i:]
                found_thinking = True
                continue
        # Check for thinking-indicator phrases
        if not found_thinking and any(m in stripped.lower() for m in ['analyze', 'identify the intent', 'determine the answer', 'formulate', 'final output']):
            thinking_lines, answer_lines = lines[:i], lines[i:]
            found_thinking = True
    
    if thinking_lines and answer_lines:
        t_text = '\n'.join(thinking_lines).strip()
        a_text = '\n'.join(answer_lines).strip()
        if len(t_text) > 20:
            return t_text, a_text
    
    # Fallback: check for  tags (simple approach)
    if '思考过程' in content or 'thinking' in content.lower():
        # This is a placeholder - could be enhanced
        pass
    
    return "", content

def get_provider(provider_name: Optional[str] = None) -> Optional[BaseProvider]:
    """
    Get a provider instance based on settings.
    
    Args:
        provider_name: Optional provider name override, otherwise uses settings
        
    Returns:
        BaseProvider instance or None if not available
    """
    settings = load_settings()
    provider = provider_name or settings.get('provider', 'lmstudio')
    
    # Build provider config from settings
    provider_config = None
    try:
        if provider == 'openrouter':
            or_settings = settings.get('openrouter', {})
            provider_config = ProviderConfig(
                provider_type='openrouter',
                api_key=or_settings.get('api_key', ''),
                base_url='https://openrouter.ai/api/v1',
                model=or_settings.get('model', 'openai/gpt-4o-mini'),
                extra_params={
                    'thinking_budget': or_settings.get('thinking_budget', 0),
                    'context_size': or_settings.get('context_size', 128000)
                }
            )
        elif provider == 'cerebras':
            cb_settings = settings.get('cerebras', {})
            provider_config = ProviderConfig(
                provider_type='cerebras',
                api_key=cb_settings.get('api_key', ''),
                base_url='https://api.cerebras.ai',
                model=cb_settings.get('model', 'llama-3.3-70b-versatile')
            )
        elif provider == 'llamacpp':
            lp_settings = settings.get('llamacpp', {})
            dl_loc = lp_settings.get('download_location', 'server')
            model_dir = os.path.join(BASE_DIR, 'models', dl_loc)
            provider_config = ProviderConfig(
                provider_type='llamacpp',
                base_url=lp_settings.get('base_url', 'http://localhost:8080'),
                model=lp_settings.get('model', ''),
                extra_params={
                    'download_location': dl_loc,
                    'model_dir': model_dir,
                    'auto_start': lp_settings.get('auto_start', False)
                }
            )
        else:  # lmstudio (default)
            ls_settings = settings.get('lmstudio', {})
            provider_config = ProviderConfig(
                provider_type='lmstudio',
                base_url=ls_settings.get('base_url', 'http://localhost:1234'),
                model=ls_settings.get('model', '')
            )
        
        # Create provider instance using registry
        registry = get_registry()
        provider_instance = registry.create_provider(provider, provider_config=provider_config)
        return provider_instance
        
    except Exception as e:
        print(f"Error creating provider '{provider}': {e}")
        return None

def get_provider_config():
    """
    Legacy function for backward compatibility.
    Returns provider config dict in old format.
    New code should use get_provider() instead.
    """
    settings = load_settings()
    provider = settings.get('provider', 'lmstudio')
    
    if provider == 'openrouter':
        return {'provider': 'openrouter', 'api_key': settings['openrouter'].get('api_key', ''), 'model': settings['openrouter'].get('model', 'openai/gpt-4o-mini'), 'base_url': 'https://openrouter.ai/api/v1', 'context_size': settings['openrouter'].get('context_size', 128000), 'thinking_budget': settings['openrouter'].get('thinking_budget', 0)}
    elif provider == 'cerebras':
        return {'provider': 'cerebras', 'api_key': settings['cerebras'].get('api_key', ''), 'model': settings['cerebras'].get('model', 'llama-3.3-70b-versatile'), 'base_url': 'https://api.cerebras.ai'}
    elif provider == 'llamacpp':
        l_settings = settings.get('llamacpp', {})
        dl_loc = l_settings.get('download_location', 'server')
        model_dir = os.path.join(BASE_DIR, 'models', dl_loc)
        return {'provider': 'llamacpp', 'base_url': l_settings.get('base_url', 'http://localhost:8080'), 'model': l_settings.get('model', ''), 'download_location': dl_loc, 'model_dir': model_dir}
    return {'provider': 'lmstudio', 'base_url': settings['lmstudio'].get('base_url', 'http://localhost:1234')}

def get_global_system_prompt():
    return load_settings().get('global_system_prompt', DEFAULT_SYSTEM_PROMPT)

def remove_emojis(text):
    if not text: return text
    emoji_pattern = re.compile(u"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\u2702-\u27B0\u24C2-\U0001F251]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text)

def format_size(bytes_size):
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if bytes_size < 1024.0: return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} PB"

# Startup Initializations
def _init_custom_voices():
    if os.path.exists(VOICE_CLONES_FILE):
        try:
            with open(VOICE_CLONES_FILE, 'r') as f:
                custom_voices.update(json.load(f))
        except: pass
    
    clones_dir = os.path.join(BASE_DIR, 'voice_clones')
    if os.path.exists(clones_dir):
        for w in os.listdir(clones_dir):
            if w.lower().endswith('.wav'):
                vid = os.path.splitext(w)[0]
                if vid not in custom_voices:
                    custom_voices[vid] = {"speaker": "default", "language": "en", "voice_clone_id": vid, "has_audio": True, "is_preloaded": True}
    
    with open(VOICE_CLONES_FILE, 'w') as f:
        json.dump(custom_voices, f, indent=2)

_init_custom_voices()