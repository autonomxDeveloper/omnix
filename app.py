"""
LM Studio Chatbot - Flask Backend
With LM Studio and OpenRouter support
"""

from flask import Flask, render_template, request, jsonify, send_file
import requests
import json
import os
from datetime import datetime
import io
import base64

app = Flask(__name__)

# Data directory
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)
SESSIONS_FILE = os.path.join(DATA_DIR, 'sessions.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

# Default settings
DEFAULT_SETTINGS = {
    "provider": "lmstudio",  # "lmstudio", "openrouter", or "cerebras"
    "global_system_prompt": "You are a helpful AI assistant.",  # Global system prompt for all sessions
    "lmstudio": {
        "base_url": "http://localhost:1234"
    },
    "openrouter": {
        "api_key": "",
        "model": "openai/gpt-4o-mini",
        "context_size": 128000,
        "thinking_budget": 0  # 0 = disabled
    },
    "cerebras": {
        "api_key": "",
        "model": "llama-3.3-70b-versatile"
    }
}

# Load or create settings
def load_settings():
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
                # Ensure all provider keys exist
                if 'cerebras' not in settings:
                    settings['cerebras'] = DEFAULT_SETTINGS['cerebras'].copy()
                if 'openrouter' not in settings:
                    settings['openrouter'] = DEFAULT_SETTINGS['openrouter'].copy()
                if 'lmstudio' not in settings:
                    settings['lmstudio'] = DEFAULT_SETTINGS['lmstudio'].copy()
                return settings
        except:
            return DEFAULT_SETTINGS.copy()
    return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=2)

# Default system prompt
DEFAULT_SYSTEM_PROMPT = "You are a helpful AI assistant."

# Load or create sessions
def load_sessions():
    if os.path.exists(SESSIONS_FILE):
        try:
            with open(SESSIONS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_sessions(sessions):
    with open(SESSIONS_FILE, 'w') as f:
        json.dump(sessions, f, indent=2)

# In-memory sessions
sessions_data = {}


def extract_thinking(content):
    """Extract thinking/reasoning from model response if present."""
    if not content:
        return "", content
    
    lines = content.split('\n')
    thinking_lines = []
    answer_lines = []
    found_thinking_marker = False
    
    for i, line in enumerate(lines):
        stripped = line.strip()
        
        # Check for thinking pattern (numbered steps)
        if stripped and all(stripped.startswith(f"{n}.") for n in range(1, 10) if stripped.startswith(f"{n}.")):
            if not found_thinking_marker and i > 0:
                prev_lines = '\n'.join(lines[:i])
                if any(marker in prev_lines.lower() for marker in ['analyze', 'identify', 'determine', 'formulate', 'check', 'output']):
                    thinking_lines = lines[:i]
                    answer_lines = lines[i:]
                    found_thinking_marker = True
                    continue
        
        if not found_thinking_marker:
            if any(marker in stripped.lower() for marker in ['analyze', 'identify the intent', 'determine the answer', 'formulate', 'final output']):
                thinking_lines = lines[:i]
                answer_lines = lines[i:]
                found_thinking_marker = True
    
    if thinking_lines and answer_lines:
        thinking_text = '\n'.join(thinking_lines).strip()
        answer_text = '\n'.join(answer_lines).strip()
        
        if len(thinking_text) > 20 and any(marker in thinking_text.lower() for marker in ['analyze', 'identify', 'determine', 'formulate', 'check', 'output']):
            return thinking_text, answer_text
    
    if '</think>' in content.lower():
        parts = content.split('</think>')
        if len(parts) > 1:
            return parts[0].strip(), parts[1].strip()
    
    return "", content


def get_provider_config():
    """Get current provider configuration"""
    settings = load_settings()
    provider = settings.get('provider', 'lmstudio')
    
    if provider == 'openrouter':
        return {
            'provider': 'openrouter',
            'api_key': settings['openrouter'].get('api_key', ''),
            'model': settings['openrouter'].get('model', 'openai/gpt-4o-mini'),
            'base_url': 'https://openrouter.ai/api/v1',
            'context_size': settings['openrouter'].get('context_size', 128000),
            'thinking_budget': settings['openrouter'].get('thinking_budget', 0)
        }
    elif provider == 'cerebras':
        return {
            'provider': 'cerebras',
            'api_key': settings['cerebras'].get('api_key', ''),
            'model': settings['cerebras'].get('model', 'llama-3.3-70b-versatile'),
            'base_url': 'https://api.cerebras.ai'
        }
    else:
        return {
            'provider': 'lmstudio',
            'base_url': settings['lmstudio'].get('base_url', 'http://localhost:1234')
        }


def get_global_system_prompt():
    """Get the global system prompt from settings"""
    settings = load_settings()
    return settings.get('global_system_prompt', DEFAULT_SYSTEM_PROMPT)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/favicon.ico')
def favicon():
    return '', 204


@app.route('/logo/<path:filename>')
def serve_logo(filename):
    """Serve logo files from the logo directory"""
    from flask import send_from_directory
    logo_dir = os.path.join(os.path.dirname(__file__), 'logo')
    return send_from_directory(logo_dir, filename)


@app.route('/api/settings', methods=['GET'])
def get_settings():
    """Get current settings"""
    settings = load_settings()
    # Don't return API key in plain text - mask both OpenRouter and Cerebras
    if settings.get('openrouter', {}).get('api_key'):
        settings['openrouter']['api_key'] = "***" + settings['openrouter']['api_key'][-4:] if len(settings['openrouter']['api_key']) > 4 else "****"
    if settings.get('cerebras', {}).get('api_key'):
        settings['cerebras']['api_key'] = "***" + settings['cerebras']['api_key'][-4:] if len(settings['cerebras']['api_key']) > 4 else "****"
    return jsonify({"success": True, "settings": settings})


@app.route('/api/settings', methods=['POST'])
def save_settings_endpoint():
    """Save settings"""
    data = request.get_json()
    settings = load_settings()
    
    if 'provider' in data:
        settings['provider'] = data['provider']
    
    # Save global system prompt
    if 'global_system_prompt' in data:
        settings['global_system_prompt'] = data['global_system_prompt']
    
    if 'lmstudio' in data:
        settings['lmstudio'].update(data['lmstudio'])
    
    if 'openrouter' in data:
        # Only update API key if not masked
        if data['openrouter'].get('api_key') and not data['openrouter']['api_key'].startswith('***'):
            settings['openrouter']['api_key'] = data['openrouter']['api_key']
        settings['openrouter'].update({k: v for k, v in data['openrouter'].items() if k != 'api_key'})
    
    if 'cerebras' in data:
        # Ensure cerebras key exists
        if 'cerebras' not in settings:
            settings['cerebras'] = {'api_key': '', 'model': 'llama-3.3-70b-versatile'}
        # Only update API key if not masked
        if data['cerebras'].get('api_key') and not data['cerebras']['api_key'].startswith('***'):
            settings['cerebras']['api_key'] = data['cerebras']['api_key']
        settings['cerebras'].update({k: v for k, v in data['cerebras'].items() if k != 'api_key'})
    
    save_settings(settings)
    return jsonify({"success": True})


@app.route('/api/openrouter/models', methods=['GET'])
def get_openrouter_models():
    """Get available OpenRouter models"""
    settings = load_settings()
    api_key = settings.get('openrouter', {}).get('api_key', '')
    
    if not api_key:
        return jsonify({"success": False, "error": "No API key configured"}), 400
    
    try:
        response = requests.get(
            "https://openrouter.ai/api/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get('data', []):
                models.append({
                    'id': model.get('id'),
                    'name': model.get('name', model.get('id'))
                })
            return jsonify({"success": True, "models": models})
        else:
            return jsonify({"success": False, "error": f"API error: {response.status_code}"}), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/cerebras/models', methods=['GET'])
def get_cerebras_models():
    """Get available Cerebras models"""
    settings = load_settings()
    api_key = settings.get('cerebras', {}).get('api_key', '')
    
    if not api_key:
        return jsonify({"success": False, "error": "No API key configured"}), 400
    
    try:
        # Fetch models from Cerebras API
        response = requests.get(
            "https://api.cerebras.ai/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            models = []
            for model in data.get('data', []):
                models.append({
                    'id': model.get('id'),
                    'name': model.get('name', model.get('id'))
                })
            return jsonify({"success": True, "models": models})
        else:
            return jsonify({"success": False, "error": f"API error: {response.status_code} - {response.text[:200]}"}), response.status_code
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/models', methods=['GET'])
def get_models():
    """Get available models from current provider"""
    try:
        settings = load_settings()
        provider = settings.get('provider', 'lmstudio')
        
        if provider == 'openrouter':
            # For OpenRouter, just return a default list (user selects from dropdown)
            return jsonify({
                "success": True, 
                "models": [settings.get('openrouter', {}).get('model', 'openai/gpt-4o-mini')]
            })
        
        if provider == 'cerebras':
            # Return the saved Cerebras model from settings
            cerebras_model = settings.get('cerebras', {}).get('model', 'llama-3.3-70b-versatile')
            return jsonify({
                "success": True, 
                "models": [cerebras_model]
            })
        
        # LM Studio
        base_url = settings.get('lmstudio', {}).get('base_url', 'http://localhost:1234')
        
        try:
            response = requests.get(f"{base_url}/v1/models", timeout=5)
            if response.status_code == 200:
                data = response.json()
                models = []
                if isinstance(data, dict):
                    for item in data.get('data', []):
                        if isinstance(item, dict) and item.get('id'):
                            models.append(item['id'])
                return jsonify({"success": True, "models": models})
            else:
                # Try legacy endpoint
                response = requests.get(f"{base_url}/api/v0/models", timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    models = [item.get('id') or item.get('model') for item in data if isinstance(item, dict)]
                    return jsonify({"success": True, "models": models})
                return jsonify({"success": False, "error": f"API returned {response.status_code}"}), 200
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 200


@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    global sessions_data
    sessions_data = load_sessions()
    session_list = []
    for sid, data in sessions_data.items():
        session_list.append({
            'id': sid,
            'title': data.get('title', 'New Chat'),
            'updated_at': data.get('updated_at', '')
        })
    session_list.sort(key=lambda x: x['updated_at'], reverse=True)
    return jsonify({"success": True, "sessions": session_list})


@app.route('/api/sessions', methods=['POST'])
def create_session():
    global sessions_data
    sessions_data = load_sessions()
    
    import uuid
    session_id = str(uuid.uuid4())[:8]
    
    # Get global system prompt for new sessions
    global_prompt = get_global_system_prompt()
    
    sessions_data[session_id] = {
        'title': 'New Chat',
        'messages': [],
        'system_prompt': global_prompt,
        'created_at': datetime.now().isoformat(),
        'updated_at': datetime.now().isoformat()
    }
    save_sessions(sessions_data)
    
    return jsonify({"success": True, "session_id": session_id})


@app.route('/api/sessions/<session_id>', methods=['GET'])
def get_session(session_id):
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id in sessions_data:
        return jsonify({"success": True, "session": sessions_data[session_id]})
    return jsonify({"success": False, "error": "Session not found"}), 404


@app.route('/api/sessions/<session_id>', methods=['DELETE'])
def delete_session(session_id):
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id in sessions_data:
        del sessions_data[session_id]
        save_sessions(sessions_data)
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Session not found"}), 404


@app.route('/api/sessions/<session_id>', methods=['PUT'])
def update_session(session_id):
    global sessions_data
    sessions_data = load_sessions()
    data = request.get_json()
    
    if session_id in sessions_data:
        if 'title' in data:
            sessions_data[session_id]['title'] = data['title']
        if 'system_prompt' in data:
            sessions_data[session_id]['system_prompt'] = data['system_prompt']
        sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
        save_sessions(sessions_data)
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Session not found"}), 404


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    
    if not data or 'message' not in data:
        return jsonify({"success": False, "error": "Message is required"}), 400
    
    user_message = data['message']
    session_id = data.get('session_id', 'default')
    model = data.get('model', '')
    
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id not in sessions_data:
        # Use global system prompt for new sessions
        global_prompt = get_global_system_prompt()
        sessions_data[session_id] = {
            'title': 'New Chat',
            'messages': [],
            'system_prompt': global_prompt,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
    
    # Always use global system prompt for all sessions (including conversation mode)
    system_prompt = get_global_system_prompt()
    
    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend([m for m in sessions_data[session_id].get('messages', []) if m.get('role') != 'system'])
    messages.append({"role": "user", "content": user_message})
    
    sessions_data[session_id]['messages'].append({"role": "user", "content": user_message})
    
    try:
        # Get provider config
        config = get_provider_config()
        
        if config['provider'] == 'openrouter':
            # OpenRouter API call
            headers = {
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "LM Studio Chatbot"
            }
            
            payload = {
                "model": model or config['model'],
                "messages": messages,
                "max_tokens": config.get('thinking_budget', 0) or 4096
            }
            
            if config.get('thinking_budget', 0) > 0:
                payload["extra_options"] = {
                    "max_tokens": config['thinking_budget']
                }
            
            response = requests.post(
                f"{config['base_url']}/chat/completions",
                json=payload,
                headers=headers,
                timeout=300
            )
        elif config['provider'] == 'cerebras':
            # Cerebras API call
            headers = {
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": model or config['model'],
                "messages": messages,
                "max_tokens": 4096
            }
            
            response = requests.post(
                f"{config['base_url']}/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=300
            )
        else:
            # LM Studio API call
            base_url = config['base_url']
            
            payload = {
                "model": model or "local-model",
                "messages": messages,
                "stream": False
            }
            
            headers = {"Content-Type": "application/json"}
            
            response = requests.post(
                f"{base_url}/v1/chat/completions",
                json=payload,
                headers=headers,
                timeout=300
            )
        
        if response.status_code == 200:
            result = response.json()
            ai_message = ""
            thinking = ""
            
            if config['provider'] == 'openrouter':
                # OpenRouter response format
                choices = result.get('choices', [])
                if choices:
                    msg = choices[0].get('message', {})
                    content = msg.get('content', '')
                    
                    # Check for reasoning in OpenRouter
                    if msg.get('reasoning'):
                        thinking = msg['reasoning']
                        ai_message = msg.get('content', '')
                    else:
                        thinking, ai_message = extract_thinking(content)
            else:
                # LM Studio response format
                choices = result.get('choices', [])
                if choices:
                    content = choices[0].get('message', {}).get('content', '')
                    thinking, ai_message = extract_thinking(content)
            
            # Get token usage
            usage = result.get('usage', {})
            prompt_tokens = usage.get('prompt_tokens', 0)
            completion_tokens = usage.get('completion_tokens', 0)
            total_tokens = usage.get('total_tokens', 0)
            
            # Update session
            sessions_data[session_id]['messages'].append({
                "role": "assistant", 
                "content": ai_message,
                "thinking": thinking if thinking else ""
            })
            
            if len(sessions_data[session_id]['messages']) == 2:
                title = user_message[:30] + "..." if len(user_message) > 30 else user_message
                sessions_data[session_id]['title'] = title
            
            sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
            save_sessions(sessions_data)
            
            return jsonify({
                "success": True,
                "response": ai_message,
                "thinking": thinking,
                "session_id": session_id,
                "tokens": {
                    "prompt": prompt_tokens,
                    "completion": completion_tokens,
                    "total": total_tokens
                }
            })
        else:
            return jsonify({
                "success": False, 
                "error": f"API error: {response.status_code} - {response.text[:200]}"
            }), response.status_code
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """Stream chat response using Server-Sent Events (SSE)"""
    from flask import Response
    
    data = request.get_json()
    
    if not data or 'message' not in data:
        return jsonify({"success": False, "error": "Message is required"}), 400
    
    user_message = data['message']
    session_id = data.get('session_id', 'default')
    model = data.get('model', '')
    
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id not in sessions_data:
        global_prompt = get_global_system_prompt()
        sessions_data[session_id] = {
            'title': 'New Chat',
            'messages': [],
            'system_prompt': global_prompt,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
    
    system_prompt = get_global_system_prompt()
    
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend([m for m in sessions_data[session_id].get('messages', []) if m.get('role') != 'system'])
    messages.append({"role": "user", "content": user_message})
    
    sessions_data[session_id]['messages'].append({"role": "user", "content": user_message})
    
    def generate():
        try:
            config = get_provider_config()
            
            if config['provider'] == 'openrouter':
                headers = {
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:5000",
                    "X-Title": "LM Studio Chatbot"
                }
                
                payload = {
                    "model": model or config['model'],
                    "messages": messages,
                    "stream": True
                }
                
                response = requests.post(
                    f"{config['base_url']}/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=300,
                    stream=True
                )
            elif config['provider'] == 'cerebras':
                headers = {
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": model or config['model'],
                    "messages": messages,
                    "stream": True
                }
                
                response = requests.post(
                    f"{config['base_url']}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=300,
                    stream=True
                )
            else:
                # LM Studio
                base_url = config['base_url']
                
                payload = {
                    "model": model or "local-model",
                    "messages": messages,
                    "stream": True
                }
                
                headers = {"Content-Type": "application/json"}
                
                response = requests.post(
                    f"{base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                    timeout=300,
                    stream=True
                )
            
            if response.status_code == 200:
                ai_message = ""
                thinking = ""
                
                for line in response.iter_lines():
                    if line:
                        line = line.decode('utf-8')
                        if line.startswith('data: '):
                            data_str = line[6:]
                            if data_str.strip() == '[DONE]':
                                break
                            
                            try:
                                chunk = json.loads(data_str)
                                
                                if config['provider'] == 'openrouter':
                                    delta = chunk.get('choices', [{}])[0].get('delta', {})
                                    content = delta.get('content', '')
                                    
                                    # Check for reasoning in OpenRouter
                                    if delta.get('reasoning'):
                                        thinking += delta['reasoning']
                                    
                                    if content:
                                        ai_message += content
                                        yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"
                                else:
                                    delta = chunk.get('choices', [{}])[0].get('delta', {})
                                    content = delta.get('content', '')
                                    
                                    if content:
                                        ai_message += content
                                        yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"
                            except json.JSONDecodeError:
                                continue
                
                # Extract thinking if not already captured
                if not thinking:
                    thinking, ai_message = extract_thinking(ai_message)
                
                # Save the complete response to session
                sessions_data[session_id]['messages'].append({
                    "role": "assistant", 
                    "content": ai_message,
                    "thinking": thinking if thinking else ""
                })
                
                if len(sessions_data[session_id]['messages']) == 2:
                    title = user_message[:30] + "..." if len(user_message) > 30 else user_message
                    sessions_data[session_id]['title'] = title
                
                sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
                save_sessions(sessions_data)
                
                # Send done signal with full data
                yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'error': f'API error: {response.status_code}'})}\n\n"
                
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/chat/voice-stream', methods=['POST'])
def chat_voice_stream():
    """Stream chat response with interleaved TTS audio generation.
    
    Streams LLM tokens as 'content' events, and as sentences complete,
    generates TTS audio in a background thread and sends 'audio' events.
    The client gets both text and audio from a single SSE connection.
    """
    from flask import Response
    from concurrent.futures import ThreadPoolExecutor
    import queue as q
    
    data = request.get_json()
    
    if not data or 'message' not in data:
        return jsonify({"success": False, "error": "Message is required"}), 400
    
    user_message = data['message']
    session_id = data.get('session_id', 'default')
    model = data.get('model', '')
    speaker = data.get('speaker', 'serena')
    
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id not in sessions_data:
        global_prompt = get_global_system_prompt()
        sessions_data[session_id] = {
            'title': 'New Chat',
            'messages': [],
            'system_prompt': global_prompt,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
    
    system_prompt = get_global_system_prompt()
    
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend([m for m in sessions_data[session_id].get('messages', []) if m.get('role') != 'system'])
    messages.append({"role": "user", "content": user_message})
    
    sessions_data[session_id]['messages'].append({"role": "user", "content": user_message})
    
    # Resolve voice clone ID from original speaker name
    voice_clone_id = None
    lookup_key = speaker.replace(" (Custom)", "")
    if lookup_key in custom_voices:
        voice_data = custom_voices[lookup_key]
        voice_clone_id = voice_data.get("voice_clone_id")
        print(f"[voice-stream] Resolved speaker '{speaker}' -> voice_clone_id: {voice_clone_id}")
    
    def generate_tts_for_sentence(text, clone_id):
        """Generate TTS audio for a phrase in a thread. Returns (pcm_base64, sample_rate) or None."""
        tts_req_start = time_module.time()
        try:
            clean_text = remove_emojis(text)
            if not clean_text.strip():
                return None
            
            # Use Chatterbox TTS - simple text input, optional voice cloning
            request_data = {
                "text": clean_text,
                "language": "en"
            }
            if clone_id:
                request_data["voice_clone_id"] = clone_id
            
            req_prep_time = (time_module.time() - tts_req_start) * 1000
            
            resp = requests.post(
                f"{TTS_BASE_URL}/tts",
                json=request_data,
                timeout=60
            )
            
            req_time = (time_module.time() - tts_req_start) * 1000
            
            if resp.status_code == 200:
                result = resp.json()
                if result.get('success'):
                    # Return raw PCM directly - skip WAV conversion for speed
                    audio_data = result.get('audio', '')
                    sample_rate = result.get('sample_rate', TTS_SAMPLE_RATE)
                    print(f"[TTS] '{text[:30]}...' prep: {req_prep_time:.0f}ms, http: {req_time:.0f}ms")
                    return (audio_data, sample_rate)
        except Exception as e:
            print(f"[voice-stream] TTS error for '{text[:30]}...': {e}")
        return None
    
    # Timing tracking
    import time as time_module
    llm_start_time = time_module.time()
    first_token_time = None
    first_tts_submit_time = None
    first_tts_complete_time = None
    
    def generate():
        # Thread pool for parallel TTS generation - more workers for faster processing
        executor = ThreadPoolExecutor(max_workers=4)
        tts_futures = []  # list of (sentence_index, future)
        audio_queue = q.Queue()  # (sentence_index, audio_base64)
        next_audio_index = [0]  # mutable counter for ordered playback
        pending_audio = {}  # index -> audio_base64 for out-of-order completions
        
        sentence_index = [0]
        
        def submit_tts(sentence_text, idx):
            """Submit TTS job and put result in audio_queue when done"""
            nonlocal first_tts_submit_time
            if first_tts_submit_time is None:
                first_tts_submit_time = time_module.time()
                print(f"[TIMING] First TTS submitted at: {first_tts_submit_time - llm_start_time:.3f}s after message")
            
            def task():
                nonlocal first_tts_complete_time
                audio = generate_tts_for_sentence(sentence_text, voice_clone_id)
                if first_tts_complete_time is None and audio:
                    first_tts_complete_time = time_module.time()
                    print(f"[TIMING] First TTS completed at: {first_tts_complete_time - llm_start_time:.3f}s after message")
                if audio:
                    audio_queue.put((idx, audio))
                else:
                    audio_queue.put((idx, None))
            future = executor.submit(task)
            tts_futures.append(future)
        
        try:
            config = get_provider_config()
            
            if config['provider'] == 'openrouter':
                headers = {
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "http://localhost:5000",
                    "X-Title": "LM Studio Chatbot"
                }
                payload = {
                    "model": model or config['model'],
                    "messages": messages,
                    "stream": True
                }
                response = requests.post(
                    f"{config['base_url']}/chat/completions",
                    json=payload, headers=headers, timeout=300, stream=True
                )
            elif config['provider'] == 'cerebras':
                headers = {
                    "Authorization": f"Bearer {config['api_key']}",
                    "Content-Type": "application/json"
                }
                payload = {
                    "model": model or config['model'],
                    "messages": messages,
                    "stream": True
                }
                response = requests.post(
                    f"{config['base_url']}/v1/chat/completions",
                    json=payload, headers=headers, timeout=300, stream=True
                )
            else:
                base_url = config['base_url']
                payload = {
                    "model": model or "local-model",
                    "messages": messages,
                    "stream": True
                }
                headers = {"Content-Type": "application/json"}
                response = requests.post(
                    f"{base_url}/v1/chat/completions",
                    json=payload, headers=headers, timeout=300, stream=True
                )
            
            if response.status_code != 200:
                yield f"data: {json.dumps({'type': 'error', 'error': f'API error: {response.status_code}'})}\n\n"
                return
            
            ai_message = ""
            thinking = ""
            phrase_buffer = ""
            word_count = [0]
            
            def flush_phrase():
                nonlocal phrase_buffer
                trimmed = phrase_buffer.strip()
                if len(trimmed) > 0:
                    idx = sentence_index[0]
                    sentence_index[0] += 1
                    submit_tts(trimmed, idx)
                    phrase_buffer = ""
                    word_count[0] = 0
            
            for line in response.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        data_str = line[6:]
                        if data_str.strip() == '[DONE]':
                            break
                        
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get('choices', [{}])[0].get('delta', {})
                            
                            if config['provider'] == 'openrouter' and delta.get('reasoning'):
                                thinking += delta['reasoning']
                            
                            content = delta.get('content', '')
                            if content:
                                nonlocal first_token_time
                                if first_token_time is None:
                                    first_token_time = time_module.time()
                                    print(f"[TIMING] First LLM token received at: {first_token_time - llm_start_time:.3f}s after message")
                                    print(f"[DEBUG] First token content: '{content}' ({len(content)} chars)")
                                
                                ai_message += content
                                phrase_buffer += content
                                word_count[0] += len(content.split())
                                
                                # Send text chunk to client immediately
                                yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"
                                
                                # ULTRA-EAGER FIRST CHUNK + EFFICIENT SUBSEQUENT CHUNKING
                                # Submit first chunk immediately, then use larger chunks
                                import re as _re
                                should_flush = False
                                trimmed = phrase_buffer.strip()
                                
                                # Debug: print state on every token for first few
                                if sentence_index[0] < 2:
                                    print(f"[DEBUG] Token #{sentence_index[0]}: buffer='{phrase_buffer[:50]}...', trimmed_len={len(trimmed)}, word_count={word_count[0]}")
                                
                                # FIRST CHUNK: Submit IMMEDIATELY on any content to start TTS
                                if sentence_index[0] == 0 and len(trimmed) > 0:
                                    should_flush = True
                                    print(f"[CHUNK] FIRST chunk submitted immediately: '{trimmed[:30]}...' ({word_count[0]} words, {len(trimmed)} chars)")
                                # SUBSEQUENT CHUNKS: Use larger chunks for efficiency
                                # Check for sentence end (. ! ?) - always flush
                                elif _re.search(r'[.!?][\s)]', phrase_buffer) and len(trimmed) > 3:
                                    should_flush = True
                                # Check for newlines - flush for natural breaks
                                elif '\n' in phrase_buffer and len(trimmed) > 10:
                                    should_flush = True
                                # Check for clause boundaries (, ; :) with longer text
                                elif _re.search(r'[,;:][\s]', phrase_buffer) and word_count[0] >= 5:
                                    should_flush = True
                                # Send chunk after 6+ words to amortize TTS overhead
                                elif word_count[0] >= 6 and len(trimmed) > 15:
                                    should_flush = True
                                
                                if should_flush:
                                    flush_phrase()
                                
                                # Also check audio queue for completed TTS
                                while not audio_queue.empty():
                                    try:
                                        idx, audio = audio_queue.get_nowait()
                                        if audio:
                                            pending_audio[idx] = audio
                                    except:
                                        break
                                
                                # Send audio in order
                                while next_audio_index[0] in pending_audio:
                                    audio_data, sample_rate = pending_audio.pop(next_audio_index[0])
                                    yield f"data: {json.dumps({'type': 'audio', 'audio': audio_data, 'sample_rate': sample_rate, 'index': next_audio_index[0]})}\n\n"
                                    next_audio_index[0] += 1
                        
                        except json.JSONDecodeError:
                            continue
            
            # Flush remaining phrase
            flush_phrase()
            
            # Extract thinking if not already captured
            if not thinking:
                thinking, ai_message = extract_thinking(ai_message)
            
            # Save to session
            sessions_data[session_id]['messages'].append({
                "role": "assistant",
                "content": ai_message,
                "thinking": thinking if thinking else ""
            })
            
            if len(sessions_data[session_id]['messages']) == 2:
                title = user_message[:30] + "..." if len(user_message) > 30 else user_message
                sessions_data[session_id]['title'] = title
            
            sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
            save_sessions(sessions_data)
            
            # Wait for all TTS jobs to complete and send remaining audio
            executor.shutdown(wait=True)
            
            while not audio_queue.empty():
                try:
                    idx, audio = audio_queue.get_nowait()
                    if audio:
                        pending_audio[idx] = audio
                except:
                    break
            
            while next_audio_index[0] in pending_audio:
                audio_data, sample_rate = pending_audio.pop(next_audio_index[0])
                yield f"data: {json.dumps({'type': 'audio', 'audio': audio_data, 'sample_rate': sample_rate, 'index': next_audio_index[0]})}\n\n"
                next_audio_index[0] += 1
            
            yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            executor.shutdown(wait=False)
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/clear', methods=['POST'])
def clear_session():
    data = request.get_json()
    session_id = data.get('session_id', 'default')
    
    global sessions_data
    sessions_data = load_sessions()
    
    if session_id in sessions_data:
        sessions_data[session_id]['messages'] = []
        sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
        save_sessions(sessions_data)
    
    return jsonify({"success": True})


# Qwen3-TTS API configuration
import re
import subprocess
import threading
import queue
import time

# Remove emojis from text for TTS
def remove_emojis(text):
    """Remove emojis from text for TTS processing"""
    if not text:
        return text
    # Remove emojis and other non-ASCII characters
    emoji_pattern = re.compile("["
        u"\U0001F600-\U0001F64F"  # emoticons
        u"\U0001F300-\U0001F5FF"  # symbols & pictographs
        u"\U0001F680-\U0001F6FF"  # transport & map symbols
        u"\U0001F1E0-\U0001F1FF"  # flags
        u"\U00002702-\U000027B0"
        u"\U000024C2-\U0001F251"
        "]+", flags=re.UNICODE)
    return emoji_pattern.sub(r'', text)

# Chatterbox TTS TURBO API configuration
# Note: Chatterbox runs on port 8020, uses 24000 Hz sample rate
TTS_BASE_URL = "http://localhost:8020"
TTS_SAMPLE_RATE = 24000  # Chatterbox uses 24kHz

# Connection pool for TTS requests - reuse connections to reduce latency
import requests as _requests
_tts_session = _requests.Session()
_tts_adapter = _requests.adapters.HTTPAdapter(
    pool_connections=4,
    pool_maxsize=8,
    max_retries=0
)
_tts_session.mount('http://', _tts_adapter)

# Speculative TTS - pre-generated filler phrases for instant response
SPECULATIVE_FILLERS = [
    "Hmm, let me think about that.",
    "Sure, I can help with that.",
    "Great question!",
    "Let me see...",
    "Okay, give me a moment.",
    "I understand.",
    "Right, let me check that for you.",
    "Interesting! Let me think.",
]

CONVERSATION_GREETINGS = [
    "Hello! I'm ready to chat. How can I help you today?",
    "Hi there! I'm listening. What's on your mind?",
    "Hey! Ready when you are. What would you like to talk about?",
]

# Cache for pre-generated speculative audio
speculative_audio_cache = {}  # text -> (audio_base64, sample_rate)
cache_lock = threading.Lock()

def pregenerate_speculative_audio(speaker="default"):
    """Pre-generate audio for filler phrases to enable instant response"""
    global speculative_audio_cache
    
    print("[SPECULATIVE] Pre-generating filler phrases...")
    
    for phrase in SPECULATIVE_FILLERS + CONVERSATION_GREETINGS:
        try:
            # Check if speaker is a custom voice clone
            voice_clone_id = None
            lookup_key = speaker.replace(" (Custom)", "")
            if lookup_key in custom_voices:
                voice_data = custom_voices[lookup_key]
                voice_clone_id = voice_data.get("voice_clone_id")
            
            request_data = {"text": phrase, "language": "en"}
            if voice_clone_id:
                request_data["voice_clone_id"] = voice_clone_id
            
            resp = requests.post(f"{TTS_BASE_URL}/tts", json=request_data, timeout=60)
            
            if resp.status_code == 200:
                result = resp.json()
                if result.get('success'):
                    with cache_lock:
                        speculative_audio_cache[phrase] = (result.get('audio', ''), result.get('sample_rate', TTS_SAMPLE_RATE))
                    print(f"[SPECULATIVE] Cached: '{phrase[:30]}...'")
        except Exception as e:
            print(f"[SPECULATIVE] Error pre-generating '{phrase[:20]}...': {e}")
    
    print(f"[SPECULATIVE] Cache ready with {len(speculative_audio_cache)} phrases")

def get_speculative_audio(text, speaker="default"):
    """Get pre-generated audio if available, or generate on-demand"""
    with cache_lock:
        if text in speculative_audio_cache:
            return speculative_audio_cache[text]
    return None

# Parakeet STT API configuration
STT_BASE_URL = "http://localhost:8000"

# Get the absolute path to the parakeet folder
PARAKEET_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'models', 'stt', 'parakeet-tdt-0.6b-v2'))

# Subprocess management
tts_process = None
stt_process = None
tts_log_queue = queue.Queue()
stt_log_queue = queue.Queue()
tts_status = {"running": False, "message": "Not started"}
stt_status = {"running": False, "message": "Not started"}

def read_process_output(process, log_queue, service_name):
    """Read subprocess output in real-time and add to log queue"""
    try:
        import codecs
        # Use latin-1 encoding which accepts all byte values (fallback for Windows)
        reader = codecs.getreader('latin-1')
        
        for line in reader(process.stdout):
            if line.strip():
                log_queue.put(f"[{service_name}] {line.strip()}")
    except Exception as e:
        log_queue.put(f"[{service_name}] Log reader error: {e}")

def start_tts_service():
    """Start CosyVoice 3.0 TTS service as subprocess"""
    global tts_process, tts_status
    
    # Kill any existing TTS processes on port 8020
    try:
        import subprocess as sp
        result = sp.run('netstat -ano ^| findstr :8020 ^| findstr LISTENING', shell=True, capture_output=True, text=True)
        lines = result.stdout.strip().split('\n')
        for line in lines:
            parts = line.split()
            if len(parts) >= 5:
                pid = parts[-1]
                try:
                    sp.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                except:
                    pass
        time.sleep(1)
    except:
        pass
    
    # Reset process variable
    tts_process = None
    
    try:
        tts_log_queue.put(f"[TTS] Starting CosyVoice 3.0 TTS server...")
        print(f"[TTS] Starting CosyVoice 3.0 TTS server...")
        
        # Start CosyVoice 3.0 TTS process
        tts_process = subprocess.Popen(
            ['python', 'cosyvoice_tts_server.py'],
            cwd=os.path.dirname(__file__),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1
        )
        
        # Start thread to read output
        thread = threading.Thread(target=read_process_output, args=(tts_process, tts_log_queue, "TTS"))
        thread.daemon = True
        thread.start()
        
        tts_status = {"running": True, "message": "Starting..."}
        tts_log_queue.put(f"[TTS] Process started with PID: {tts_process.pid}")
        print(f"[TTS] Process started with PID: {tts_process.pid}")
        
    except Exception as e:
        tts_status = {"running": False, "message": f"Error: {str(e)}"}
        tts_log_queue.put(f"[TTS] Error starting: {e}")
        print(f"[TTS] Error starting: {e}")

def start_stt_service():
    """Start Parakeet STT service as subprocess"""
    global stt_process, stt_status
    
    # Kill any existing STT processes first - only kill the parakeet app.py, not all python
    # First check if there's a process on port 8000 and kill it
    try:
        import subprocess as sp
        result = sp.run('netstat -ano | findstr :8000 | findstr LISTENING', shell=True, capture_output=True, text=True)
        lines = result.stdout.strip().split('\n')
        for line in lines:
            parts = line.split()
            if len(parts) >= 5:
                pid = parts[-1]
                try:
                    sp.run(f'taskkill /F /PID {pid}', shell=True, capture_output=True)
                except:
                    pass
        time.sleep(1)
    except:
        pass
    
    # Reset process variable
    stt_process = None
    
    try:
        stt_script = os.path.join(PARAKEET_DIR, 'app.py')
        if not os.path.exists(stt_script):
            stt_status = {"running": False, "message": "STT script not found"}
            print(f"[STT] Script not found at: {stt_script}")
            return
        
        stt_log_queue.put(f"[STT] Starting Parakeet STT server...")
        print(f"[STT] Starting Parakeet from: {stt_script}")
        
        # Start Parakeet STT process with binary output to avoid encoding issues
        stt_process = subprocess.Popen(
            ['python', stt_script],
            cwd=PARAKEET_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1
        )
        
        # Start thread to read output
        thread = threading.Thread(target=read_process_output, args=(stt_process, stt_log_queue, "STT"))
        thread.daemon = True
        thread.start()
        
        stt_status = {"running": True, "message": "Starting..."}
        stt_log_queue.put(f"[STT] Process started with PID: {stt_process.pid}")
        print(f"[STT] Process started with PID: {stt_process.pid}")
        
    except Exception as e:
        stt_status = {"running": False, "message": f"Error: {str(e)}"}
        stt_log_queue.put(f"[STT] Error starting: {e}")
        print(f"[STT] Error starting: {e}")

def stop_tts_service():
    """Stop TTS service"""
    global tts_process, tts_status
    
    if tts_process:
        try:
            tts_process.terminate()
            tts_process.wait(timeout=10)
            tts_log_queue.put("[TTS] Process terminated")
        except:
            tts_process.kill()
            tts_log_queue.put("[TTS] Process killed")
    
    tts_process = None
    tts_status = {"running": False, "message": "Stopped"}

def stop_stt_service():
    """Stop STT service"""
    global stt_process, stt_status
    
    if stt_process:
        try:
            stt_process.terminate()
            stt_process.wait(timeout=10)
            stt_log_queue.put("[STT] Process terminated")
        except:
            stt_process.kill()
            stt_log_queue.put("[STT] Process killed")
    
    stt_process = None
    stt_status = {"running": False, "message": "Stopped"}

def get_service_logs(log_queue, max_lines=50):
    """Get recent logs from queue - peek without consuming"""
    logs = []
    temp_logs = []
    try:
        # First, collect all logs without removing them
        while not log_queue.empty():
            try:
                log = log_queue.get_nowait()
                temp_logs.append(log)
            except:
                break
        
        # Put them back
        for log in temp_logs:
            log_queue.put(log)
        
        # Return the last max_lines
        logs = temp_logs[-max_lines:] if temp_logs else []
    except:
        pass
    return logs

# Language to default speaker mapping - maps language codes to speaker file names
# Note: XTTS expects just the filename (e.g., "femalenord.wav") not the full path
# Using actual WAV files from the speakers folder
LANGUAGE_DEFAULT_SPEAKER = {
    "en": "en/femalenord.wav",  # English default speaker
    "es": "en/femalenord.wav",
    "fr": "en/femalenord.wav", 
    "de": "en/femalenord.wav",
    "it": "en/femalenord.wav",
    "pt": "en/femalenord.wav",
    "pl": "en/femalenord.wav",
    "tr": "en/femalenord.wav",
    "ru": "en/femalenord.wav",
    "ja": "en/femalenord.wav",
    "ko": "en/femalenord.wav",
    "zh-cn": "en/femalenord.wav",
    "hi": "en/femalenord.wav",
    "ar": "en/femalenord.wav",
    "cs": "en/femalenord.wav",
    "hu": "en/femalenord.wav",
    "nl": "en/femalenord.wav",
}

# Map latent speaker names to actual WAV files
# This maps latent speaker JSON names to their corresponding WAV files
LATENT_TO_WAV_MAP = {
    "jinx": "en/jinx.wav",
    "anakawinter-mane": "en/anakawinter-mane.wav",
    "ciri": "en/ciri.wav",
    "femalenord": "en/femalenord.wav",
    "heather": "en/heather.wav",
    "her": "en/her.wav",
    "inigo": "en/inigo.wav",
    "morgan": "en/morgan.wav",
    "nate": "en/nate.wav",
    "sofia": "en/sofia.wav",
    "vcyber": "en/vcyber.wav",
}

# Initialize Qwen3-TTS - verify connection and start if not running
def init_tts():
    """Initialize Qwen3-TTS - verify connection and start if not running"""
    print("Checking Qwen3-TTS server status...")
    
    # Try to connect multiple times
    for attempt in range(3):
        try:
            response = requests.get(f"{TTS_BASE_URL}/speakers", timeout=10)
            if response.status_code == 200:
                print(f"Qwen3-TTS server already running - connected successfully")
                return True
            else:
                print(f"Qwen3-TTS init attempt {attempt+1}: {response.status_code}")
        except Exception as e:
            print(f"Qwen3-TTS init attempt {attempt+1} failed: {e}")
        
        if attempt < 2:
            print("Waiting for Qwen3-TTS to start...")
            time.sleep(5)
    
    # If we get here, TTS is not running, start it
    print("Starting Qwen3-TTS server...")
    start_tts_service()
    print("Waiting 30 seconds for Qwen3-TTS to fully initialize (this can take 20-30 seconds)...")
    time.sleep(30)
    
    # Verify it started
    try:
        response = requests.get(f"{TTS_BASE_URL}/speakers", timeout=10)
        if response.status_code == 200:
            print(f"Qwen3-TTS server started successfully!")
            return True
        else:
            print(f"Qwen3-TTS may still be starting (HTTP {response.status_code})")
    except Exception as e:
        print(f"Qwen3-TTS server may still be loading: {e}")
    
    print("Qwen3-TTS server start command sent - will continue in background")
    return False

# Note: TTS and STT services should be started manually:
# - Chatterbox TTS: python chatterbox_tts_server.py (port 8020)
# - Parakeet STT: python models/stt/parakeet-tdt-0.6b-v2/app.py (port 8000)
print("=" * 50)
print("Note: Start services manually if needed:")
print("  - Chatterbox TTS: python chatterbox_tts_server.py")
print("  - Parakeet STT: cd models/stt/parakeet-tdt-0.6b-v2 && python app.py")
print("=" * 50)


# Get available speakers from Qwen3-TTS
def get_available_speakers():
    """Get list of available speakers from Qwen3-TTS server"""
    speakers = []
    
    try:
        response = requests.get(f"{TTS_BASE_URL}/speakers", timeout=5)
        if response.status_code == 200:
            data = response.json()
            for s in data.get('speakers', []):
                speakers.append({
                    "id": s,
                    "name": s,
                    "language": "en"
                })
    except:
        pass
    
    return speakers


@app.route('/api/tts', methods=['POST'])
def text_to_speech():
    """Convert text to speech using Chatterbox TTS TURBO API"""
    data = request.get_json()
    
    if not data or 'text' not in data:
        return jsonify({"success": False, "error": "Text is required"}), 400
    
    # Remove emojis and special characters for TTS
    text = remove_emojis(data['text'])
    speaker = data.get('speaker', 'default')  # Default speaker
    
    # Debug: print all custom voices
    print(f"[TTS] Available custom voices: {list(custom_voices.keys())}")
    print(f"[TTS] Requested speaker: '{speaker}'")
    
    # Check if speaker is a custom voice clone
    voice_clone_id = None
    lookup_key = speaker.replace(" (Custom)", "")
    
    print(f"[TTS] Lookup key: '{lookup_key}'")
    
    if lookup_key in custom_voices:
        voice_data = custom_voices[lookup_key]
        voice_clone_id = voice_data.get("voice_clone_id")
        print(f"[TTS] Found custom voice! voice_clone_id: {voice_clone_id}")
    else:
        print(f"[TTS] No custom voice found for '{lookup_key}', using default")
    
    try:
        # Debug logging
        print(f"[TTS] Final - text: {text[:50]}..., speaker: {speaker}, voice_clone_id: {voice_clone_id}")
        
        # Chatterbox TTS - simple text input, optional voice cloning
        request_data = {
            "text": text,
            "language": "en"
        }
        if voice_clone_id:
            request_data["voice_clone_id"] = voice_clone_id
        
        response = requests.post(
            f"{TTS_BASE_URL}/tts",
            json=request_data,
            timeout=60
        )
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                # Chatterbox returns raw PCM, convert to WAV for browser playback
                import io
                import wave
                
                audio_data = result.get('audio', '')
                sample_rate = result.get('sample_rate', TTS_SAMPLE_RATE)
                
                # Decode base64 to raw PCM bytes
                raw_bytes = base64.b64decode(audio_data)
                
                # Convert to numpy array
                import numpy as np
                audio_array = np.frombuffer(raw_bytes, dtype=np.int16)
                
                # Create WAV in memory
                wav_io = io.BytesIO()
                with wave.open(wav_io, 'wb') as wav_file:
                    wav_file.setnchannels(1)  # mono
                    wav_file.setsampwidth(2)  # 16-bit
                    wav_file.setframerate(sample_rate)
                    wav_file.writeframes(audio_array.tobytes())
                
                # Get WAV bytes and encode to base64
                wav_io.seek(0)
                wav_bytes = wav_io.read()
                wav_base64 = base64.b64encode(wav_bytes).decode('utf-8')
                
                return jsonify({
                    "success": True,
                    "audio": wav_base64,
                    "sample_rate": sample_rate,
                    "format": "audio/wav"
                })
            else:
                return jsonify({
                    "success": False, 
                    "error": result.get('error', 'Unknown error')
                }), 500
        else:
            return jsonify({
                "success": False, 
                "error": f"TTS error: {response.status_code} - {response.text[:200]}"
            }), response.status_code
    except requests.exceptions.ConnectionError:
        return jsonify({"success": False, "error": "Cannot connect to TTS server. Make sure Chatterbox TTS is running on port 8020."}), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/tts/stream', methods=['POST'])
def text_to_speech_stream():
    """Stream TTS audio using SSE - sends audio chunks as they're generated for faster perceived response.
    
    Uses the Chatterbox streaming endpoint to generate audio sentence-by-sentence.
    Each audio chunk is sent as an SSE event as soon as it's ready.
    """
    from flask import Response
    
    data = request.get_json()
    
    if not data or 'text' not in data:
        return jsonify({"success": False, "error": "Text is required"}), 400
    
    # Remove emojis and special characters for TTS
    text = remove_emojis(data['text'])
    speaker = data.get('speaker', 'default')
    
    # Check if speaker is a custom voice clone
    voice_clone_id = None
    lookup_key = speaker.replace(" (Custom)", "")
    
    if lookup_key in custom_voices:
        voice_data = custom_voices[lookup_key]
        voice_clone_id = voice_data.get("voice_clone_id")
        print(f"[TTS-STREAM] Using voice clone: {voice_clone_id}")
    
    def generate():
        try:
            # Split text into sentences for streaming
            # Split text into sentences for streaming
            import re
            sentences = re.split(r'(?<=[.!?])\s+', text)
            sentences = [s.strip() for s in sentences if s.strip()]
            
            if not sentences:
                sentences = [text]
            
            print(f"[TTS-STREAM] Streaming {len(sentences)} sentences")
            
            for i, sentence in enumerate(sentences):
                if not sentence.strip():
                    continue
                
                # Generate audio for this sentence
                request_data = {
                    "text": sentence,
                    "language": "en"
                }
                if voice_clone_id:
                    request_data["voice_clone_id"] = voice_clone_id
                
                try:
                    response = requests.post(
                        f"{TTS_BASE_URL}/tts",
                        json=request_data,
                        timeout=60
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        if result.get('success'):
                            audio_data = result.get('audio', '')
                            sample_rate = result.get('sample_rate', TTS_SAMPLE_RATE)
                            
                            # Send audio chunk as SSE event
                            yield f"data: {json.dumps({'type': 'audio', 'audio': audio_data, 'sample_rate': sample_rate, 'index': i})}\n\n"
                            print(f"[TTS-STREAM] Sent chunk {i+1}/{len(sentences)}")
                except Exception as e:
                    print(f"[TTS-STREAM] Error on chunk {i}: {e}")
                    yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
            
            # Signal completion
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            print(f"[TTS-STREAM] Completed streaming {len(sentences)} chunks")
            
        except Exception as e:
            print(f"[TTS-STREAM] Error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')


@app.route('/api/tts/speakers', methods=['GET'])
def get_speakers():
    """Get available speakers for TTS"""
    # Get from Qwen3-TTS API
    speakers = get_available_speakers()
    
    # If still empty, use default speaker list
    if not speakers:
        speakers = [
            {"id": "serena", "name": "Serena"},
            {"id": "aiden", "name": "Aiden"},
            {"id": "dylan", "name": "Dylan"},
            {"id": "eric", "name": "Eric"},
            {"id": "ryan", "name": "Ryan"},
            {"id": "sohee", "name": "Sohee"},
            {"id": "vivian", "name": "Vivian"},
            {"id": "ono_anna", "name": " Ono Anna"},
            {"id": "uncle_fu", "name": "Uncle Fu"}
        ]
    
    # Add custom voices to the list
    for voice_name, voice_data in custom_voices.items():
        speakers.append({
            "id": voice_name,
            "name": f"{voice_name} (Custom)",
            "language": voice_data.get("language", "en"),
            "is_custom": True
        })
    
    return jsonify({"success": True, "speakers": speakers})


# ==================== SPEECH TO TEXT (STT) ====================

# ==================== VOICE CLONING ====================
# Note: Voice cloning is not supported in Qwen3-TTS
# Custom voices are mapped to built-in speakers

# Store custom voice mappings (voice_name -> voice_clone_id)
# These persist across server restarts
custom_voices = {}

# File to store voice clone mappings persistently
VOICE_CLONES_FILE = os.path.join(DATA_DIR, 'voice_clones.json')

def load_voice_clones():
    """Load voice clones from file"""
    if os.path.exists(VOICE_CLONES_FILE):
        try:
            with open(VOICE_CLONES_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_voice_clones(clones):
    """Save voice clones to file"""
    with open(VOICE_CLONES_FILE, 'w') as f:
        json.dump(clones, f, indent=2)

# Load saved voice clones on startup
custom_voices = load_voice_clones()

@app.route('/api/voice_clones', methods=['GET'])
def get_voice_clones():
    """Get list of all saved voice clones"""
    voices = []
    for voice_name, voice_data in custom_voices.items():
        voices.append({
            "id": voice_name,
            "language": voice_data.get("language", "en"),
            "has_audio": voice_data.get("has_audio", False)
        })
    return jsonify({"success": True, "voices": voices})


@app.route('/api/voice_clones/<voice_id>', methods=['DELETE'])
def delete_voice_clone(voice_id):
    """Delete a voice clone"""
    global custom_voices
    
    if voice_id not in custom_voices:
        return jsonify({"success": False, "error": "Voice not found"}), 404
    
    # Delete from Chatterbox TTS server if it has audio
    voice_data = custom_voices[voice_id]
    if voice_data.get("has_audio"):
        try:
            response = requests.delete(
                f"{TTS_BASE_URL}/voice_clone/{voice_id}",
                timeout=10
            )
            print(f"Deleted voice clone from TTS server: {response.status_code}")
        except Exception as e:
            print(f"Warning: Could not delete from TTS server: {e}")
    
    # Delete from local storage
    del custom_voices[voice_id]
    save_voice_clones(custom_voices)
    
    return jsonify({"success": True, "message": f"Voice '{voice_id}' deleted"})


@app.route('/api/voice_clone', methods=['POST'])
def voice_clone():
    """Create a voice clone using Chatterbox TTS.
    
    Upload a 3-10 second audio sample for voice cloning.
    Chatterbox uses reference audio for zero-shot voice cloning.
    """
    try:
        # Get form data
        voice_name = request.form.get('name', '').strip() or request.form.get('voice_id', '').strip()
        language = request.form.get('language', 'en')
        
        if not voice_name:
            return jsonify({"success": False, "error": "Voice name is required"}), 400
        
        # Check if audio file is provided
        audio_file = request.files.get('audio') or request.files.get('file')
        
        if audio_file:
            # Forward the audio to Chatterbox for voice cloning
            try:
                files = {
                    'file': (audio_file.filename, audio_file.stream, audio_file.content_type or 'audio/wav')
                }
                data = {
                    'voice_id': voice_name,
                    'ref_text': request.form.get('ref_text', '')
                }
                
                response = requests.post(
                    f"{TTS_BASE_URL}/voice_clone",
                    files=files,
                    data=data,
                    timeout=60
                )
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success'):
                        # Store the voice clone reference
                        custom_voices[voice_name] = {
                            "speaker": "default",
                            "language": language,
                            "voice_clone_id": voice_name,
                            "has_audio": True
                        }
                        save_voice_clones(custom_voices)
                        
                        return jsonify({
                            "success": True,
                            "voice_id": voice_name,
                            "message": f"Voice clone '{voice_name}' created successfully"
                        })
                else:
                    print(f"Chatterbox voice clone failed: {response.status_code}")
            except Exception as e:
                print(f"Error forwarding to Chatterbox: {e}")
        
        # Fallback: store voice mapping without audio
        # This allows the voice name to be used as an identifier
        custom_voices[voice_name] = {
            "speaker": "default",
            "language": language,
            "voice_clone_id": voice_name,
            "has_audio": False
        }
        save_voice_clones(custom_voices)
        
        return jsonify({
            "success": True,
            "voice_id": voice_name,
            "message": f"Voice '{voice_name}' registered. Upload audio for voice cloning."
        })
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/stt', methods=['POST'])
def speech_to_text():
    """Convert speech audio to text using Parakeet TDT"""
    if 'audio' not in request.files:
        return jsonify({"success": False, "error": "No audio file provided"}), 400
    
    audio_file = request.files['audio']
    
    try:
        # Send audio to Parakeet STT API
        files = {
            'file': (audio_file.filename, audio_file.stream, audio_file.content_type or 'audio/webm')
        }
        
        response = requests.post(
            f"{STT_BASE_URL}/transcribe",
            files=files,
            timeout=120
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                # Combine all segments into full transcript
                full_text = ' '.join([seg['text'] for seg in data.get('segments', [])])
                return jsonify({
                    "success": True,
                    "text": full_text,
                    "segments": data.get('segments', []),
                    "duration": data.get('duration')
                })
            else:
                return jsonify({
                    "success": False,
                    "error": data.get('message', 'Transcription failed')
                }), 500
        else:
            return jsonify({
                "success": False,
                "error": f"STT API error: {response.status_code} - {response.text[:200]}"
            }), response.status_code
            
    except requests.exceptions.ConnectionError:
        return jsonify({
            "success": False,
            "error": "Cannot connect to STT server. Make sure Parakeet STT is running on port 8000."
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/stt/health', methods=['GET'])
def stt_health_check():
    """Check STT server health"""
    try:
        response = requests.get(f"{STT_BASE_URL}/health", timeout=5)
        if response.status_code == 200:
            return jsonify({
                "success": True,
                "status": response.json()
            })
        else:
            return jsonify({
                "success": False,
                "error": f"STT server error: {response.status_code}"
            }), 503
    except requests.exceptions.ConnectionError:
        return jsonify({
            "success": False,
            "error": "Cannot connect to STT server"
        }), 503
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 503


# ==================== SERVICE MANAGEMENT ====================

@app.route('/api/services/status', methods=['GET'])
def services_status():
    """Get status of all services"""
    global tts_status, stt_status
    
    # Check TTS (CosyVoice uses /health endpoint)
    tts_running = False
    try:
        response = requests.get(f"{TTS_BASE_URL}/health", timeout=2)
        tts_running = response.status_code == 200
    except:
        pass
    
    # Update internal TTS status to match actual state
    if tts_running:
        if not tts_status.get("running", False):
            tts_status = {"running": True, "message": "Running (external)"}
    else:
        if tts_status.get("running", False):
            tts_status = {"running": False, "message": "Stopped"}
    
    # Check STT
    stt_running = False
    try:
        response = requests.get(f"{STT_BASE_URL}/health", timeout=2)
        stt_running = response.status_code == 200
    except:
        pass
    
    # Update internal STT status to match actual state
    if stt_running:
        if not stt_status.get("running", False):
            stt_status = {"running": True, "message": "Running (external)"}
    else:
        if stt_status.get("running", False):
            stt_status = {"running": False, "message": "Stopped"}
    
    return jsonify({
        "success": True,
        "tts": {
            "running": tts_running,
            "managed": True,
            "status": tts_status
        },
        "stt": {
            "running": stt_running,
            "managed": True,
            "status": stt_status
        }
    })

@app.route('/api/services/tts/start', methods=['POST'])
def start_tts():
    """Start TTS service"""
    start_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/tts/stop', methods=['POST'])
def stop_tts():
    """Stop TTS service"""
    stop_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/tts/restart', methods=['POST'])
def restart_tts():
    """Restart TTS service"""
    stop_tts_service()
    time.sleep(2)
    start_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/tts/logs', methods=['GET'])
def get_tts_logs():
    """Get TTS logs"""
    logs = get_service_logs(tts_log_queue, 100)
    return jsonify({"success": True, "logs": logs})


# XTTS endpoints (alias for TTS - frontend uses xtts naming)
@app.route('/api/services/xtts/start', methods=['POST'])
def start_xtts():
    """Start XTTS service (alias for TTS)"""
    start_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/xtts/stop', methods=['POST'])
def stop_xtts():
    """Stop XTTS service (alias for TTS)"""
    stop_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/xtts/restart', methods=['POST'])
def restart_xtts():
    """Restart XTTS service (alias for TTS)"""
    stop_tts_service()
    time.sleep(2)
    start_tts_service()
    return jsonify({"success": True, "status": tts_status})

@app.route('/api/services/xtts/logs', methods=['GET'])
def get_xtts_logs():
    """Get XTTS logs (alias for TTS)"""
    logs = get_service_logs(tts_log_queue, 100)
    return jsonify({"success": True, "logs": logs})

@app.route('/api/services/stt/start', methods=['POST'])
def start_stt():
    """Start STT service"""
    start_stt_service()
    return jsonify({"success": True, "status": stt_status})

@app.route('/api/services/stt/stop', methods=['POST'])
def stop_stt():
    """Stop STT service"""
    stop_stt_service()
    return jsonify({"success": True, "status": stt_status})

@app.route('/api/services/stt/restart', methods=['POST'])
def restart_stt():
    """Restart STT service"""
    stop_stt_service()
    time.sleep(2)
    start_stt_service()
    return jsonify({"success": True, "status": stt_status})

@app.route('/api/services/stt/logs', methods=['GET'])
def get_stt_logs():
    """Get STT logs"""
    logs = get_service_logs(stt_log_queue, 100)
    return jsonify({"success": True, "logs": logs})


@app.route('/api/tts/pregenerate', methods=['POST'])
def pregenerate_tts():
    """Pre-generate speculative audio for instant response"""
    data = request.get_json() or {}
    speaker = data.get('speaker', 'default')
    
    # Run pre-generation in background thread
    def run_pregenerate():
        pregenerate_speculative_audio(speaker)
    
    thread = threading.Thread(target=run_pregenerate)
    thread.daemon = True
    thread.start()
    
    return jsonify({"success": True, "message": "Pre-generation started in background"})


@app.route('/api/tts/speculative', methods=['GET'])
def get_speculative():
    """Get a random pre-generated filler phrase for instant response"""
    import random
    
    # Get a random filler phrase
    phrase = random.choice(SPECULATIVE_FILLERS)
    
    # Check if we have cached audio
    audio = get_speculative_audio(phrase)
    if audio:
        audio_data, sample_rate = audio
        return jsonify({
            "success": True,
            "text": phrase,
            "audio": audio_data,
            "sample_rate": sample_rate
        })
    
    return jsonify({"success": False, "error": "No speculative audio cached"})


@app.route('/api/conversation/greeting', methods=['GET', 'POST'])
def get_conversation_greeting():
    """Get a pre-generated greeting for conversation mode startup"""
    import random
    
    # Get speaker from query param (GET) or JSON body (POST)
    if request.method == 'POST':
        data = request.get_json() or {}
        speaker = data.get('speaker', 'default')
    else:
        speaker = request.args.get('speaker', 'default')
    
    print(f"[GREETING] Requested speaker: {speaker}")
    
    # Get a random greeting
    greeting = random.choice(CONVERSATION_GREETINGS)
    
    # Resolve voice clone ID from speaker name
    voice_clone_id = None
    lookup_key = speaker.replace(" (Custom)", "")
    if lookup_key in custom_voices:
        voice_data = custom_voices[lookup_key]
        voice_clone_id = voice_data.get("voice_clone_id")
        print(f"[GREETING] Resolved speaker '{speaker}' -> voice_clone_id: {voice_clone_id}")
    
    # If using a custom voice, generate on-demand (don't use cache)
    if voice_clone_id:
        try:
            request_data = {"text": greeting, "language": "en", "voice_clone_id": voice_clone_id}
            resp = requests.post(f"{TTS_BASE_URL}/tts", json=request_data, timeout=60)
            
            if resp.status_code == 200:
                result = resp.json()
                if result.get('success'):
                    return jsonify({
                        "success": True,
                        "text": greeting,
                        "audio": result.get('audio', ''),
                        "sample_rate": result.get('sample_rate', TTS_SAMPLE_RATE)
                    })
        except Exception as e:
            print(f"[GREETING] Error with custom voice: {e}")
    
    # Check if we have cached audio for default voice
    audio = get_speculative_audio(greeting)
    if audio:
        audio_data, sample_rate = audio
        return jsonify({
            "success": True,
            "text": greeting,
            "audio": audio_data,
            "sample_rate": sample_rate
        })
    
    # Generate on-demand if not cached
    try:
        request_data = {"text": greeting, "language": "en"}
        
        resp = requests.post(f"{TTS_BASE_URL}/tts", json=request_data, timeout=60)
        
        if resp.status_code == 200:
            result = resp.json()
            if result.get('success'):
                return jsonify({
                    "success": True,
                    "text": greeting,
                    "audio": result.get('audio', ''),
                    "sample_rate": result.get('sample_rate', TTS_SAMPLE_RATE)
                })
    except Exception as e:
        print(f"[GREETING] Error: {e}")
    
    return jsonify({"success": False, "error": "TTS not available"})


@app.route('/api/health', methods=['GET'])
def health_check():
    try:
        config = get_provider_config()
        
        if config['provider'] == 'openrouter':
            if not config.get('api_key'):
                return jsonify({"status": "disconnected", "message": "No API key configured"}), 200
            return jsonify({"status": "connected", "provider": "openrouter", "url": "openrouter.ai"})
        
        if config['provider'] == 'cerebras':
            if not config.get('api_key'):
                return jsonify({"status": "disconnected", "message": "No API key configured"}), 200
            return jsonify({"status": "connected", "provider": "cerebras", "url": "api.cerebras.ai"})
        
        # Check LM Studio
        response = requests.get(f"{config['base_url']}/v1/models", timeout=5)
        if response.status_code == 200:
            return jsonify({"status": "connected", "provider": "lmstudio", "url": config['base_url']})
        return jsonify({"status": "disconnected", "message": "LM Studio not available"}), 200
    except Exception as e:
        return jsonify({"status": "disconnected", "message": str(e)}), 200


# ==================== AUDIOBOOK FEATURE ====================

# Common male and female name patterns for speaker detection
FEMALE_NAMES = {
    'sofia', 'sophia', 'emma', 'olivia', 'ava', 'isabella', 'mia', 'charlotte',
    'amelia', 'harper', 'evelyn', 'abigail', 'emily', 'elizabeth', 'sofie',
    'julia', 'hannah', 'lena', 'anna', 'maria', 'sarah', 'laura', 'kate',
    'katherine', 'rebecca', 'rachel', 'jessica', 'jennifer', 'ashley', 'amanda',
    'samantha', 'brittany', 'stephanie', 'nicole', 'heather', 'michelle', 'lisa',
    'nancy', 'karen', 'betty', 'helen', 'sandra', 'donna', 'carol', 'sharon',
    'ciri', 'vivian', 'serena', 'sohee', 'her', 'anaka'
}

MALE_NAMES = {
    'morgan', 'james', 'john', 'robert', 'michael', 'william', 'david', 'richard',
    'joseph', 'thomas', 'charles', 'christopher', 'daniel', 'matthew', 'anthony',
    'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua', 'eric', 'ryan',
    'nate', 'nathan', 'inigo', 'aiden', 'dylan', 'uncle_fu', 'jinx'
}

def detect_speaker_gender(speaker_name):
    """Detect gender from speaker name for voice assignment"""
    if not speaker_name:
        return 'neutral'
    
    name_lower = speaker_name.lower().strip()
    
    # Check for explicit gender indicators
    if any(word in name_lower for word in ['ms.', 'mrs.', 'miss', 'she', 'her', 'woman', 'female', 'lady', 'girl']):
        return 'female'
    if any(word in name_lower for word in ['mr.', 'mr', 'he', 'him', 'man', 'male', 'boy', 'guy']):
        return 'male'
    
    # Check known names
    if name_lower in FEMALE_NAMES:
        return 'female'
    if name_lower in MALE_NAMES:
        return 'male'
    
    # Check partial matches
    for female_name in FEMALE_NAMES:
        if female_name in name_lower or name_lower in female_name:
            return 'female'
    for male_name in MALE_NAMES:
        if male_name in name_lower or name_lower in male_name:
            return 'male'
    
    return 'neutral'

def get_voice_for_speaker(speaker_name, available_voices, default_female=None, default_male=None, default_neutral=None):
    """Get appropriate voice for a speaker based on detected gender"""
    gender = detect_speaker_gender(speaker_name)
    
    # Check if speaker name matches a custom voice directly
    if speaker_name:
        speaker_lower = speaker_name.lower().strip()
        for voice_name in available_voices:
            if speaker_lower == voice_name.lower() or speaker_lower in voice_name.lower():
                return voice_name
    
    # Fall back to gender-based default
    if gender == 'female' and default_female:
        return default_female
    elif gender == 'male' and default_male:
        return default_male
    
    return default_neutral or default_female or default_male or list(available_voices)[0] if available_voices else None

def extract_text_from_pdf(pdf_file):
    """Extract text from PDF file"""
    try:
        import PyPDF2
        
        pdf_reader = PyPDF2.PdfReader(pdf_file)
        text = ""
        for page in pdf_reader.pages:
            text += page.extract_text() + "\n"
        return text
    except ImportError:
        return None, "PyPDF2 not installed. Install with: pip install PyPDF2"
    except Exception as e:
        return None, f"Error reading PDF: {str(e)}"

def parse_dialogue(text):
    """Parse text to identify speakers and their dialogue.
    
    Comprehensive speaker detection supporting:
    1. Direct Label Format: "Speaker: text"
    2. Dialogue Followed by Attribution: "Hi there," David said.
    3. Dialogue with Inverted Attribution: "Hi there," said David.
    4. Attribution Before Dialogue: David said, "Hi there."
    5. Mid-Sentence Attribution: "I don't know," David said, "maybe later."
    6. Dialogue with Action Beat Attribution: "Hi." David smiled.
    7. Multiple Speakers in One Paragraph
    8. Paragraph-Based Speaker Continuation
    9. Implied Attribution with Clear Conversational Alternation
    10. Internal thoughts excluded (marked with "thought")
    """
    import re
    
    segments = []
    
    # Speech verbs for attribution detection
    speech_verbs = r'(?:said|asked|replied|whispered|shouted|murmured|answered|added|continued|responded|cried|called|stated|muttered|yelled|exclaimed|remarked|declared|announced|interrupted|snapped|growled|hissed|muttered|spluttered|gasped|breathed|sighed|moaned|groaned|laughed|chuckled|smiled|grinned|beamed)'
    
    # Pattern 1: Direct Label Format - "Speaker: text"
    direct_label_pattern = re.compile(r'^([A-Z][A-Za-z\'\-]+(?:\s+[A-Z][A-Za-z\'\-]+)*)\s*:\s*(.+)$', re.MULTILINE)
    
    # Pattern 2 & 3: Dialogue Followed by Attribution - "text," Name said. OR "text," said Name.
    quote_after_pattern = re.compile(r'["\']([^"\']+)["\']\s*,?\s*(?:' + speech_verbs + r')\s+([A-Z][A-Za-z\'\-]+(?:\s+[A-Z][A-Za-z\'\-]+)*)', re.IGNORECASE)
    
    # Pattern 3: Inverted - "text," said Name.
    quote_inverted_pattern = re.compile(r'["\']([^"\']+)["\']\s*,?\s*(?:' + speech_verbs + r')\s+([A-Z][A-Za-z\'\-]+(?:\s+[A-Z][A-Za-z\'\-]+)*)', re.IGNORECASE)
    
    # Pattern 4: Attribution Before Dialogue - Name said, "text"
    attr_before_pattern = re.compile(r'([A-Z][A-Za-z\'\-]+(?:\s+[A-Z][A-Za-z\'\-]+)*)\s+' + speech_verbs + r'\s*[,:\s]*\s*["\']([^"\']+)["\']', re.IGNORECASE)
    
    # Pattern 5 & 6: Mid-sentence or action beat - "text," Name said/verb, "more text" OR "text." Name action.
    mid_sentence_pattern = re.compile(r'["\']([^"\']+)["\']\s*[,\.]?\s*([A-Z][A-Za-z\'\-]+(?:\s+[A-Z][A-Za-z\'\-]+)*)\s+(' + speech_verbs + r'|\w+ed)\s*[,\.\s]?\s*["\']?([^"\']*)["\']?', re.IGNORECASE)
    
    # Pattern for internal thoughts - exclude these
    thought_pattern = re.compile(r'([A-Z][A-Za-z\'\-]+)\s+(?:thought|wondered|considered|mused|reflected)\s*[,:\s]*\s*["\']([^"\']+)["\']', re.IGNORECASE)
    
    # Split by paragraphs - handle both double newlines and single newlines
    # First try double newlines, then fall back to single newlines
    paragraphs = re.split(r'\n\s*\n', text)
    
    # If we got very few paragraphs but there are single newlines, try single newline split
    if len(paragraphs) <= 2 and '\n' in text:
        # Check if single newlines give us more reasonable paragraph breaks
        single_split = [p.strip() for p in text.split('\n') if p.strip()]
        if len(single_split) > len(paragraphs):
            paragraphs = single_split
    
    last_speaker = None
    alternating_speakers = []  # Track for alternation pattern
    
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        
        # Track all dialogues found in this paragraph
        para_dialogues = []
        
        # Check for internal thoughts first - mark but don't include
        thoughts = thought_pattern.findall(para)
        thought_texts = [t[1] for t in thoughts]
        
        # Pattern 1: Direct Label Format
        direct_matches = list(direct_label_pattern.finditer(para))
        if direct_matches:
            for match in direct_matches:
                speaker = match.group(1).strip()
                dialogue = match.group(2).strip()
                if dialogue and not any(thought in dialogue for thought in thought_texts):
                    para_dialogues.append({
                        'speaker': speaker,
                        'text': dialogue,
                        'type': 'dialogue',
                        'start': match.start(),
                        'end': match.end()
                    })
                    last_speaker = speaker
                    if speaker not in alternating_speakers:
                        alternating_speakers.append(speaker)
        
        # Pattern 4: Attribution Before Dialogue
        if not para_dialogues:
            attr_before_matches = list(attr_before_pattern.finditer(para))
            if attr_before_matches:
                for match in attr_before_matches:
                    speaker = match.group(1).strip()
                    dialogue = match.group(2).strip()
                    if dialogue and not any(thought in dialogue for thought in thought_texts):
                        para_dialogues.append({
                            'speaker': speaker,
                            'text': dialogue,
                            'type': 'dialogue',
                            'start': match.start(),
                            'end': match.end()
                        })
                        last_speaker = speaker
                        if speaker not in alternating_speakers:
                            alternating_speakers.append(speaker)
        
        # Pattern 2 & 3: Dialogue Followed by Attribution
        if not para_dialogues:
            quote_after_matches = list(quote_after_pattern.finditer(para))
            if quote_after_matches:
                for match in quote_after_matches:
                    dialogue = match.group(1).strip()
                    speaker = match.group(2).strip()
                    if dialogue and not any(thought in dialogue for thought in thought_texts):
                        para_dialogues.append({
                            'speaker': speaker,
                            'text': dialogue,
                            'type': 'dialogue',
                            'start': match.start(),
                            'end': match.end()
                        })
                        last_speaker = speaker
                        if speaker not in alternating_speakers:
                            alternating_speakers.append(speaker)
        
        # Pattern 5: Mid-sentence Attribution - split quotes
        if not para_dialogues:
            mid_matches = list(mid_sentence_pattern.finditer(para))
            if mid_matches:
                for match in mid_matches:
                    dialogue1 = match.group(1).strip()
                    speaker = match.group(2).strip()
                    dialogue2 = match.group(4).strip() if match.group(4) else ''
                    
                    # Check if it's a speech verb
                    verb = match.group(3).lower() if match.group(3) else ''
                    is_speech = any(sv in verb for sv in ['said', 'ask', 'repl', 'whisper', 'shout', 'murmur', 'answer', 'add', 'continu', 'respond', 'cried', 'call', 'state', 'mutter', 'yell', 'exclaim', 'remark', 'declar', 'announc', 'interrupt', 'snap', 'growl', 'hiss', 'splutter', 'gasp', 'breath', 'sigh', 'moan', 'groan', 'laugh', 'chuckl'])
                    
                    # Also allow action beats with smile/grin/beam for dialogue
                    is_action_beat = any(ab in verb for ab in ['smile', 'grin', 'beam'])
                    
                    if is_speech or is_action_beat:
                        if dialogue1 and not any(thought in dialogue1 for thought in thought_texts):
                            para_dialogues.append({
                                'speaker': speaker,
                                'text': dialogue1,
                                'type': 'dialogue',
                                'start': match.start(),
                                'end': match.end()
                            })
                            last_speaker = speaker
                            if speaker not in alternating_speakers:
                                alternating_speakers.append(speaker)
                        
                        # Combine both parts if mid-sentence split
                        if dialogue2 and not any(thought in dialogue2 for thought in thought_texts):
                            full_dialogue = dialogue1 + ' ' + dialogue2 if dialogue1 else dialogue2
                            para_dialogues.append({
                                'speaker': speaker,
                                'text': dialogue2,
                                'type': 'dialogue',
                                'start': match.start(),
                                'end': match.end()
                            })
        
        # Pattern 7: Multiple speakers in one paragraph - find all quoted segments
        if not para_dialogues:
            # Find all quotes with their surrounding context
            all_quotes = list(re.finditer(r'["\']([^"\']+)["\']', para))
            if len(all_quotes) > 1:
                for i, quote_match in enumerate(all_quotes):
                    dialogue = quote_match.group(1).strip()
                    quote_start = quote_match.start()
                    quote_end = quote_match.end()
                    
                    # Look for attribution near this quote
                    context_before = para[:quote_start][-50:] if quote_start > 0 else ''
                    context_after = para[quote_end:quote_end+50] if quote_end < len(para) else ''
                    
                    speaker = None
                    
                    # Check for attribution after quote
                    attr_after = re.search(r'(?:' + speech_verbs + r')\s+([A-Z][A-Za-z\'\-]+)', context_after, re.IGNORECASE)
                    if attr_after:
                        speaker = attr_after.group(1).strip()
                    
                    # Check for attribution before quote
                    if not speaker:
                        attr_before = re.search(r'([A-Z][A-Za-z\'\-]+)\s+' + speech_verbs, context_before, re.IGNORECASE)
                        if attr_before:
                            speaker = attr_before.group(1).strip()
                    
                    # Pattern 8: Continuation from last speaker
                    if not speaker and last_speaker:
                        speaker = last_speaker
                    
                    # Pattern 9: Alternating speakers
                    if not speaker and len(alternating_speakers) == 2:
                        speaker = alternating_speakers[1] if last_speaker == alternating_speakers[0] else alternating_speakers[0]
                    
                    if dialogue and not any(thought in dialogue for thought in thought_texts):
                        para_dialogues.append({
                            'speaker': speaker or 'Unknown',
                            'text': dialogue,
                            'type': 'dialogue',
                            'start': quote_start,
                            'end': quote_end
                        })
                        if speaker:
                            last_speaker = speaker
                            if speaker not in alternating_speakers:
                                alternating_speakers.append(speaker)
        
        # Single quote without attribution
        if not para_dialogues:
            single_quote = re.search(r'^["\']([^"\']+)["\']', para)
            if single_quote:
                dialogue = single_quote.group(1).strip()
                if dialogue and not any(thought in dialogue for thought in thought_texts):
                    # Try to find speaker from context
                    speaker = last_speaker or 'Unknown'
                    para_dialogues.append({
                        'speaker': speaker,
                        'text': dialogue,
                        'type': 'dialogue',
                        'start': 0,
                        'end': len(para)
                    })
        
        # Add all dialogues found, or treat as narration
        if para_dialogues:
            # Sort by position and add
            para_dialogues.sort(key=lambda x: x.get('start', 0))
            
            # Check for narration BEFORE the first dialogue
            first_dialogue_start = para_dialogues[0].get('start', 0)
            if first_dialogue_start > 0:
                pre_text = para[:first_dialogue_start].strip()
                # Remove quotes and clean up
                pre_text = re.sub(r'["\'].*?["\']', '', pre_text).strip()
                pre_text = re.sub(r'\s+', ' ', pre_text).strip()
                # Remove trailing incomplete phrases (like "Grandmother:" without dialogue)
                pre_text = re.sub(r'[A-Z][A-Za-z\'\-]+\s*:\s*$', '', pre_text).strip()
                if pre_text and len(pre_text) > 5:
                    segments.append({
                        'speaker': 'Narrator',
                        'text': pre_text,
                        'type': 'narration'
                    })
            
            for d in para_dialogues:
                segments.append({
                    'speaker': d['speaker'],
                    'text': d['text'],
                    'type': 'dialogue'
                })
        else:
            # Check if it's pure narration (no quotes)
            has_quotes = '"' in para or "'" in para
            if not has_quotes:
                segments.append({
                    'speaker': 'Narrator',
                    'text': para,
                    'type': 'narration'
                })
    
    return segments

@app.route('/api/audiobook/upload', methods=['POST'])
def audiobook_upload():
    """Upload text or PDF file for audiobook conversion"""
    try:
        text = None
        
        # Check for file upload
        if 'file' in request.files:
            file = request.files['file']
            if file.filename:
                filename = file.filename.lower()
                
                if filename.endswith('.pdf'):
                    text, error = extract_text_from_pdf(file)
                    if error:
                        return jsonify({"success": False, "error": error}), 400
                elif filename.endswith('.txt'):
                    text = file.read().decode('utf-8')
                else:
                    return jsonify({"success": False, "error": "Unsupported file type. Use .txt or .pdf"}), 400
        
        # Check for pasted text
        if not text and request.form.get('text'):
            text = request.form.get('text')
        
        if not text and request.is_json:
            data = request.get_json()
            text = data.get('text', '')
        
        if not text or not text.strip():
            return jsonify({"success": False, "error": "No text provided"}), 400
        
        # Parse dialogue
        segments = parse_dialogue(text)
        
        # Get unique speakers
        speakers = list(set(seg['speaker'] for seg in segments if seg['speaker']))
        
        return jsonify({
            "success": True,
            "text_length": len(text),
            "segments": segments,
            "speakers": speakers,
            "total_segments": len(segments)
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/audiobook/generate', methods=['POST'])
def audiobook_generate():
    """Generate audiobook with multi-speaker support using streaming"""
    from flask import Response
    
    data = request.get_json()
    
    if not data or 'segments' not in data:
        return jsonify({"success": False, "error": "Segments are required"}), 400
    
    segments = data.get('segments', [])
    voice_mapping = data.get('voice_mapping', {})  # speaker_name -> voice_id
    default_voices = data.get('default_voices', {})  # female, male, narrator voice IDs
    
    # Get available custom voices
    available_voices = set(custom_voices.keys())
    
    def generate():
        try:
            total = len(segments)
            
            for i, segment in enumerate(segments):
                speaker = segment.get('speaker')
                text = segment.get('text', '')
                
                if not text.strip():
                    continue
                
                # Determine which voice to use
                voice_clone_id = None
                voice_name = None
                
                # Check explicit voice mapping first
                if speaker and speaker in voice_mapping:
                    voice_name = voice_mapping[speaker]
                    if voice_name in custom_voices:
                        voice_clone_id = custom_voices[voice_name].get('voice_clone_id')
                else:
                    # Auto-assign based on speaker gender
                    voice_name = get_voice_for_speaker(
                        speaker,
                        available_voices,
                        default_voices.get('female'),
                        default_voices.get('male'),
                        default_voices.get('narrator')
                    )
                    if voice_name and voice_name in custom_voices:
                        voice_clone_id = custom_voices[voice_name].get('voice_clone_id')
                
                # Clean text for TTS
                clean_text = remove_emojis(text)
                
                # Generate TTS
                request_data = {
                    "text": clean_text,
                    "language": "en"
                }
                if voice_clone_id:
                    request_data["voice_clone_id"] = voice_clone_id
                
                try:
                    response = requests.post(
                        f"{TTS_BASE_URL}/tts",
                        json=request_data,
                        timeout=60
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        if result.get('success'):
                            event_data = {
                                'type': 'audio',
                                'audio': result.get('audio', ''),
                                'sample_rate': result.get('sample_rate', TTS_SAMPLE_RATE),
                                'segment_index': i,
                                'total_segments': total,
                                'speaker': speaker,
                                'text': text[:100] + '...' if len(text) > 100 else text,
                                'voice_used': voice_name
                            }
                            yield "data: " + json.dumps(event_data) + "\n\n"
                        else:
                            event_data = {
                                'type': 'error',
                                'segment_index': i,
                                'error': result.get('error', 'TTS failed')
                            }
                            yield "data: " + json.dumps(event_data) + "\n\n"
                    else:
                        event_data = {
                            'type': 'error',
                            'segment_index': i,
                            'error': 'TTS error: ' + str(response.status_code)
                        }
                        yield "data: " + json.dumps(event_data) + "\n\n"
                        
                except Exception as e:
                    event_data = {
                        'type': 'error',
                        'segment_index': i,
                        'error': str(e)
                    }
                    yield "data: " + json.dumps(event_data) + "\n\n"
                
                # Small delay between segments
                time.sleep(0.1)
            
            event_data = {'type': 'done', 'total_segments': total}
            yield "data: " + json.dumps(event_data) + "\n\n"
            
        except Exception as e:
            event_data = {'type': 'error', 'error': str(e)}
            yield "data: " + json.dumps(event_data) + "\n\n"
    
    return Response(generate(), mimetype='text/event-stream')

@app.route('/api/audiobook/speakers/detect', methods=['POST'])
def detect_speakers():
    """Detect speakers in text and suggest voice assignments"""
    data = request.get_json()
    
    if not data or 'text' not in data:
        return jsonify({"success": False, "error": "Text is required"}), 400
    
    text = data.get('text', '')
    segments = parse_dialogue(text)
    
    # Get unique speakers
    speakers = {}
    for seg in segments:
        speaker = seg.get('speaker')
        if speaker and speaker not in speakers:
            gender = detect_speaker_gender(speaker)
            speakers[speaker] = {
                'name': speaker,
                'gender': gender,
                'suggested_voice': None,  # Will be filled below
                'segment_count': 1
            }
        elif speaker:
            speakers[speaker]['segment_count'] += 1
    
    # Get available voices
    available_voices = list(custom_voices.keys())
    
    # Suggest voices for each speaker
    for speaker_name, speaker_info in speakers.items():
        gender = speaker_info['gender']
        
        # Check if there's a voice with matching name
        matching_voice = None
        for voice in available_voices:
            if speaker_name.lower() in voice.lower() or voice.lower() in speaker_name.lower():
                matching_voice = voice
                break
        
        if matching_voice:
            speaker_info['suggested_voice'] = matching_voice
        else:
            # Suggest based on gender
            if gender == 'female':
                speaker_info['suggested_voice'] = next((v for v in available_voices if 'female' in v.lower() or any(n in v.lower() for n in ['sofia', 'emma', 'olivia', 'her', 'ciri'])), available_voices[0] if available_voices else None)
            elif gender == 'male':
                speaker_info['suggested_voice'] = next((v for v in available_voices if 'male' in v.lower() or any(n in v.lower() for n in ['morgan', 'james', 'nate', 'inigo'])), available_voices[0] if available_voices else None)
            else:
                speaker_info['suggested_voice'] = available_voices[0] if available_voices else None
    
    return jsonify({
        "success": True,
        "speakers": speakers,
        "available_voices": available_voices,
        "total_segments": len(segments)
    })


# ==================== AI PODCASTING FEATURE ====================

# Podcast data storage
PODCAST_DATA_DIR = os.path.join(DATA_DIR, 'podcasts')
os.makedirs(PODCAST_DATA_DIR, exist_ok=True)

PODCAST_EPISODES_FILE = os.path.join(PODCAST_DATA_DIR, 'episodes.json')
PODCAST_VOICE_PROFILES_FILE = os.path.join(PODCAST_DATA_DIR, 'voice_profiles.json')


def load_podcast_episodes():
    """Load podcast episodes from file"""
    if os.path.exists(PODCAST_EPISODES_FILE):
        try:
            with open(PODCAST_EPISODES_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}


def save_podcast_episodes(episodes):
    """Save podcast episodes to file"""
    with open(PODCAST_EPISODES_FILE, 'w') as f:
        json.dump(episodes, f, indent=2)


def load_podcast_voice_profiles():
    """Load voice profiles from file"""
    if os.path.exists(PODCAST_VOICE_PROFILES_FILE):
        try:
            with open(PODCAST_VOICE_PROFILES_FILE, 'r') as f:
                return json.load(f)
        except:
            return []
    return []


def save_podcast_voice_profiles(profiles):
    """Save voice profiles to file"""
    with open(PODCAST_VOICE_PROFILES_FILE, 'w') as f:
        json.dump(profiles, f, indent=2)


# ==================== VOICE PROFILE API ====================

@app.route('/api/podcast/voice-profiles', methods=['GET'])
def get_podcast_voice_profiles():
    """Get all voice profiles"""
    profiles = load_podcast_voice_profiles()
    return jsonify({"success": True, "profiles": profiles})


@app.route('/api/podcast/voice-profiles', methods=['POST'])
def create_podcast_voice_profile():
    """Create a new voice profile"""
    data = request.get_json()
    
    if not data or not data.get('name'):
        return jsonify({"success": False, "error": "Name is required"}), 400
    
    profiles = load_podcast_voice_profiles()
    
    profile = {
        "id": data.get('id', f"vp_{int(time.time())}_{os.urandom(4).hex()}"),
        "name": data['name'],
        "voice_id": data.get('voice_id'),
        "personality": data.get('personality', ''),
        "llm_prompt": data.get('llm_prompt', ''),  # Optional prompt for LLM to define this speaker's personality
        "speaking_speed": data.get('speaking_speed', 1.0),
        "energy_level": data.get('energy_level', 'medium'),
        "formality": data.get('formality', 'neutral'),
        "humor_level": data.get('humor_level', 'subtle'),
        "signature_phrases": data.get('signature_phrases', []),
        "created_at": datetime.now().isoformat()
    }
    
    profiles.append(profile)
    save_podcast_voice_profiles(profiles)
    
    return jsonify({"success": True, "profile": profile})


@app.route('/api/podcast/voice-profiles/<profile_id>', methods=['PUT'])
def update_podcast_voice_profile(profile_id):
    """Update a voice profile"""
    data = request.get_json()
    profiles = load_podcast_voice_profiles()
    
    for i, profile in enumerate(profiles):
        if profile['id'] == profile_id:
            profiles[i].update({
                "name": data.get('name', profile['name']),
                "voice_id": data.get('voice_id'),
                "personality": data.get('personality', profile.get('personality', '')),
                "llm_prompt": data.get('llm_prompt', profile.get('llm_prompt', '')),
                "speaking_speed": data.get('speaking_speed', profile.get('speaking_speed', 1.0)),
                "energy_level": data.get('energy_level', profile.get('energy_level', 'medium')),
                "formality": data.get('formality', profile.get('formality', 'neutral')),
                "humor_level": data.get('humor_level', profile.get('humor_level', 'subtle')),
                "signature_phrases": data.get('signature_phrases', profile.get('signature_phrases', [])),
                "updated_at": datetime.now().isoformat()
            })
            save_podcast_voice_profiles(profiles)
            return jsonify({"success": True, "profile": profiles[i]})
    
    return jsonify({"success": False, "error": "Profile not found"}), 404


@app.route('/api/podcast/voice-profiles/<profile_id>', methods=['DELETE'])
def delete_podcast_voice_profile(profile_id):
    """Delete a voice profile"""
    profiles = load_podcast_voice_profiles()
    
    for i, profile in enumerate(profiles):
        if profile['id'] == profile_id:
            profiles.pop(i)
            save_podcast_voice_profiles(profiles)
            return jsonify({"success": True})
    
    return jsonify({"success": False, "error": "Profile not found"}), 404


# ==================== EPISODE MANAGEMENT API ====================

@app.route('/api/podcast/episodes', methods=['GET'])
def get_podcast_episodes():
    """Get all podcast episodes"""
    episodes = load_podcast_episodes()
    
    episode_list = []
    for ep_id, ep_data in episodes.items():
        episode_list.append({
            "id": ep_id,
            "title": ep_data.get('title', 'Untitled'),
            "format": ep_data.get('format', 'conversation'),
            "duration": ep_data.get('duration', 0),
            "created_at": ep_data.get('created_at', ''),
            "status": ep_data.get('status', 'draft')
        })
    
    episode_list.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return jsonify({"success": True, "episodes": episode_list})


@app.route('/api/podcast/episodes/<episode_id>', methods=['GET'])
def get_podcast_episode(episode_id):
    """Get a specific episode"""
    episodes = load_podcast_episodes()
    
    if episode_id not in episodes:
        return jsonify({"success": False, "error": "Episode not found"}), 404
    
    episode = episodes[episode_id]
    audio_path = os.path.join(PODCAST_DATA_DIR, f"{episode_id}.wav")
    if os.path.exists(audio_path):
        episode['audio_url'] = f"/api/podcast/episodes/{episode_id}/audio"
    
    return jsonify({"success": True, "episode": episode})


@app.route('/api/podcast/episodes/<episode_id>', methods=['PUT'])
def save_podcast_episode(episode_id):
    """Save/update an episode"""
    data = request.get_json()
    
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    episodes = load_podcast_episodes()
    
    if episode_id not in episodes:
        data['created_at'] = datetime.now().isoformat()
    
    data['updated_at'] = datetime.now().isoformat()
    episodes[episode_id] = data
    
    save_podcast_episodes(episodes)
    return jsonify({"success": True, "episode": data})


@app.route('/api/podcast/episodes/<episode_id>', methods=['DELETE'])
def delete_podcast_episode(episode_id):
    """Delete an episode"""
    episodes = load_podcast_episodes()
    
    if episode_id not in episodes:
        return jsonify({"success": False, "error": "Episode not found"}), 404
    
    del episodes[episode_id]
    save_podcast_episodes(episodes)
    
    audio_path = os.path.join(PODCAST_DATA_DIR, f"{episode_id}.wav")
    if os.path.exists(audio_path):
        os.remove(audio_path)
    
    return jsonify({"success": True})


@app.route('/api/podcast/episodes/<episode_id>/audio', methods=['GET'])
def get_podcast_episode_audio(episode_id):
    """Get episode audio file"""
    audio_path = os.path.join(PODCAST_DATA_DIR, f"{episode_id}.wav")
    
    if not os.path.exists(audio_path):
        return jsonify({"success": False, "error": "Audio not found"}), 404
    
    return send_file(audio_path, mimetype='audio/wav')


# ==================== OUTLINE GENERATION ====================

@app.route('/api/podcast/outline', methods=['POST'])
def generate_podcast_outline():
    """Generate an episode outline using LLM"""
    data = request.get_json()
    
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    title = data.get('title', '')
    topic = data.get('topic', '')
    talking_points = data.get('talking_points', [])
    format_type = data.get('format', 'conversation')
    length = data.get('length', 'medium')
    speakers = data.get('speakers', [])
    
    if not topic:
        return jsonify({"success": False, "error": "Topic is required"}), 400
    
    length_config = {
        'short': {'minutes': 5, 'segments': 3},
        'medium': {'minutes': 15, 'segments': 6},
        'long': {'minutes': 30, 'segments': 10},
        'extended': {'minutes': 60, 'segments': 15}
    }.get(length, {'minutes': 15, 'segments': 6})
    
    speaker_names = [s.get('name', 'Speaker') for s in speakers]
    
    prompt = f"""You are a podcast scriptwriter. Create a detailed outline for a podcast episode.

EPISODE DETAILS:
- Title: {title or 'TBD'}
- Topic: {topic}
- Format: {format_type}
- Target Duration: ~{length_config['minutes']} minutes
- Number of segments: {length_config['segments']}
- Speakers: {', '.join(speaker_names)}

TALKING POINTS:
{chr(10).join(f'- {point}' for point in talking_points) if talking_points else 'None provided - generate based on topic'}

Create a structured outline with the following JSON format:
{{
    "outline": "Full text outline",
    "sections": [
        {{
            "title": "Section Title",
            "description": "What happens in this section",
            "key_points": ["Point 1", "Point 2"],
            "speaker_notes": {{"Speaker Name": "What they should focus on"}},
            "estimated_duration": "2-3 minutes"
        }}
    ]
}}

Make the outline engaging, natural, and suited for audio format. Return ONLY the JSON, no other text."""

    try:
        config = get_provider_config()
        messages = [{"role": "user", "content": prompt}]
        
        if config['provider'] == 'openrouter':
            headers = {
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "LM Studio Chatbot"
            }
            payload = {"model": config['model'], "messages": messages, "max_tokens": 4096}
            response = requests.post(f"{config['base_url']}/chat/completions", json=payload, headers=headers, timeout=120)
        elif config['provider'] == 'cerebras':
            headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}
            payload = {"model": config['model'], "messages": messages, "max_tokens": 4096}
            response = requests.post(f"{config['base_url']}/v1/chat/completions", json=payload, headers=headers, timeout=120)
        else:
            payload = {"model": "local-model", "messages": messages, "stream": False}
            headers = {"Content-Type": "application/json"}
            response = requests.post(f"{config['base_url']}/v1/chat/completions", json=payload, headers=headers, timeout=120)
        
        if response.status_code == 200:
            result = response.json()
            content = result['choices'][0]['message']['content']
            
            try:
                import re
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    outline_data = json.loads(json_match.group())
                else:
                    outline_data = json.loads(content)
                
                return jsonify({
                    "success": True,
                    "outline": outline_data.get('outline', content),
                    "sections": outline_data.get('sections', [])
                })
            except json.JSONDecodeError:
                return jsonify({
                    "success": True,
                    "outline": content,
                    "sections": [{"title": "Main Content", "description": content[:200], "key_points": [], "estimated_duration": "5 minutes"}]
                })
        else:
            return jsonify({"success": False, "error": f"LLM error: {response.status_code}"}), 500
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ==================== EPISODE GENERATION ====================

@app.route('/api/podcast/generate', methods=['POST'])
def generate_podcast_episode():
    """Generate a complete podcast episode with streaming audio"""
    from flask import Response
    
    data = request.get_json()
    
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    episode_id = data.get('id', f"ep_{int(time.time())}")
    title = data.get('title', 'Untitled Episode')
    topic = data.get('topic', '')
    format_type = data.get('format', 'conversation')
    length = data.get('length', 'medium')
    speakers = data.get('speakers', [])
    outline_sections = data.get('outline_sections', [])
    
    if not topic:
        return jsonify({"success": False, "error": "Topic is required"}), 400
    
    if len(speakers) < 1:
        return jsonify({"success": False, "error": "At least one speaker is required"}), 400
    
    def generate():
        try:
            transcript = []
            audio_segments = []
            
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'script', 'percent': 5, 'message': 'Generating script...'})}\n\n"
            
            # Build speaker info with personality and LLM prompt
            speaker_info = []
            speaker_prompts = {}
            for s in speakers:
                profile = None
                if s.get('profile_id'):
                    profiles = load_podcast_voice_profiles()
                    profile = next((p for p in profiles if p['id'] == s['profile_id']), None)
                
                info = f"- {s['name']}"
                if s.get('voice_id'):
                    info += f" (voice: {s['voice_id']})"
                if profile and profile.get('personality'):
                    info += f": {profile['personality']}"
                speaker_info.append(info)
                
                # Store LLM prompt for this speaker - check both profile and direct speaker object
                prompt = s.get('llm_prompt') or (profile.get('llm_prompt') if profile else None)
                if prompt:
                    speaker_prompts[s['name']] = prompt
            
            # Generate script with optional speaker prompts
            script_prompt_parts = [
                "You are writing a podcast script. Write engaging, natural-sounding dialogue.",
                "",
                f"EPISODE: {title}",
                f"TOPIC: {topic}",
                f"FORMAT: {format_type}",
                "",
                "SPEAKERS:",
                chr(10).join(speaker_info)
            ]
            
            # Add speaker-specific prompts if available
            if speaker_prompts:
                script_prompt_parts.append("")
                script_prompt_parts.append("SPEAKER PERSONALITY PROMPTS:")
                for name, prompt in speaker_prompts.items():
                    script_prompt_parts.append(f"- {name}: {prompt}")
            
            script_prompt_parts.extend([
                "",
                "Write a script with natural dialogue. Each line should be:",
                "SPEAKER_NAME: Their dialogue here.",
                "",
                "Make it conversational with natural speech patterns. Write approximately 100-150 words per minute of content.",
                "Generate 10-15 dialogue turns for each speaker."
            ])
            
            script_prompt = chr(10).join(script_prompt_parts)

            sections = outline_sections if outline_sections else [{"title": "Main Discussion", "description": topic}]
            script_content = generate_podcast_script(script_prompt)
            script_segments = parse_script_segments(script_content, speakers)
            total_segments = len(script_segments)
            
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'script', 'percent': 30, 'message': f'Generated {total_segments} dialogue segments'})}\n\n"
            
            # Generate audio
            yield f"data: {json.dumps({'type': 'phase', 'phase': 'audio', 'percent': 35, 'message': 'Starting audio generation...'})}\n\n"
            
            for i, segment in enumerate(script_segments):
                speaker_name = segment['speaker']
                text = segment['text']
                
                # Case-insensitive speaker matching
                speaker_config = None
                speaker_lower = speaker_name.lower().strip() if speaker_name else ""
                for s in speakers:
                    if s.get('name', '').lower().strip() == speaker_lower:
                        speaker_config = s
                        break
                
                # Fall back to first speaker if no match
                if not speaker_config and speakers:
                    speaker_config = speakers[0]
                
                voice_id = speaker_config.get('voice_id') if speaker_config else None
                
                voice_clone_id = None
                if voice_id:
                    lookup_key = voice_id.replace(" (Custom)", "")
                    if lookup_key in custom_voices:
                        voice_clone_id = custom_voices[lookup_key].get("voice_clone_id", voice_id)
                    else:
                        voice_clone_id = voice_id
                
                try:
                    clean_text = remove_emojis(text)
                    request_data = {"text": clean_text, "language": "en"}
                    if voice_clone_id:
                        request_data["voice_clone_id"] = voice_clone_id
                    
                    tts_response = requests.post(f"{TTS_BASE_URL}/tts", json=request_data, timeout=60)
                    
                    if tts_response.status_code == 200:
                        tts_result = tts_response.json()
                        if tts_result.get('success'):
                            audio_data = tts_result.get('audio', '')
                            sample_rate = tts_result.get('sample_rate', TTS_SAMPLE_RATE)
                            
                            percent = 35 + int((i / max(total_segments, 1)) * 60)
                            
                            event_data = {
                                'type': 'audio',
                                'audio': audio_data,
                                'sample_rate': sample_rate,
                                'segment_index': i,
                                'speaker': speaker_name,
                                'text': text[:100] + '...' if len(text) > 100 else text,
                                'voice_used': voice_id or 'default',
                                'percent': percent
                            }
                            yield f"data: {json.dumps(event_data)}\n\n"
                            
                            transcript.append({"speaker": speaker_name, "text": text, "segment_index": i})
                            audio_segments.append({"audio": audio_data, "sample_rate": sample_rate})
                            
                except Exception as e:
                    print(f"[PODCAST] Error generating audio for segment {i}: {e}")
                
                time.sleep(0.05)
            
            yield f"data: {json.dumps({'type': 'transcript', 'transcript': transcript})}\n\n"
            
            total_duration = sum(len(seg['text'].split()) * 0.3 for seg in transcript)
            
            done_event = {'type': 'done', 'duration': total_duration, 'token_usage': {}, 'episode_id': episode_id}
            yield f"data: {json.dumps(done_event)}\n\n"
            
            # Save episode
            episodes = load_podcast_episodes()
            episodes[episode_id] = {
                "id": episode_id,
                "title": title,
                "topic": topic,
                "format": format_type,
                "length": length,
                "speakers": speakers,
                "transcript": transcript,
                "duration": total_duration,
                "status": "complete",
                "created_at": datetime.now().isoformat()
            }
            save_podcast_episodes(episodes)
            
            # Save combined audio
            if audio_segments:
                save_combined_audio(audio_segments, episode_id)
            
        except Exception as e:
            print(f"[PODCAST] Generation error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')


def generate_podcast_script(prompt):
    """Generate podcast script using LLM"""
    try:
        config = get_provider_config()
        messages = [{"role": "user", "content": prompt}]
        
        if config['provider'] == 'openrouter':
            headers = {
                "Authorization": f"Bearer {config['api_key']}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "LM Studio Chatbot"
            }
            payload = {"model": config['model'], "messages": messages, "max_tokens": 4096}
            response = requests.post(f"{config['base_url']}/chat/completions", json=payload, headers=headers, timeout=120)
        elif config['provider'] == 'cerebras':
            headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}
            payload = {"model": config['model'], "messages": messages, "max_tokens": 4096}
            response = requests.post(f"{config['base_url']}/v1/chat/completions", json=payload, headers=headers, timeout=120)
        else:
            payload = {"model": "local-model", "messages": messages, "stream": False}
            headers = {"Content-Type": "application/json"}
            response = requests.post(f"{config['base_url']}/v1/chat/completions", json=payload, headers=headers, timeout=120)
        
        if response.status_code == 200:
            result = response.json()
            return result['choices'][0]['message']['content']
        return ""
    except Exception as e:
        print(f"[PODCAST] Script generation error: {e}")
        return ""


def parse_script_segments(script_content, speakers):
    """Parse script content into segments"""
    import re
    segments = []
    
    # Build a case-insensitive map of speaker names
    speaker_map = {}  # lowercase name -> original name
    for s in speakers:
        name = s.get('name', 'Speaker')
        speaker_map[name.lower()] = name
    
    # Match patterns like "Speaker Name: dialogue"
    pattern = r'^([A-Za-z][A-Za-z\s]+?):\s*(.+)$'
    
    for line in script_content.split('\n'):
        line = line.strip()
        if not line:
            continue
        
        match = re.match(pattern, line)
        if match:
            speaker = match.group(1).strip()
            text = match.group(2).strip()
            
            if text and speaker:
                # Normalize speaker name to match our case-insensitive map
                normalized_speaker = speaker_map.get(speaker.lower(), speaker)
                segments.append({"speaker": normalized_speaker, "text": text})
    
    # If no segments found, create a simple one
    if not segments and speakers:
        segments.append({
            "speaker": speakers[0].get('name', 'Speaker'),
            "text": script_content[:500]
        })
    
    return segments


def save_combined_audio(audio_segments, episode_id):
    """Combine audio segments and save to file"""
    try:
        if not audio_segments:
            return
        
        sample_rate = audio_segments[0].get('sample_rate', TTS_SAMPLE_RATE)
        
        # Combine all PCM data
        pcm_arrays = []
        total_length = 0
        
        for seg in audio_segments:
            audio_data = seg.get('audio', '')
            if audio_data:
                binary_string = base64.b64decode(audio_data)
                pcm_arrays.append(binary_string)
                total_length += len(binary_string)
        
        if total_length == 0:
            return
        
        # Concatenate PCM
        combined_pcm = bytearray(total_length)
        offset = 0
        for pcm in pcm_arrays:
            combined_pcm[offset:offset + len(pcm)] = pcm
            offset += len(pcm)
        
        # Create WAV
        wav_buffer = create_wav_buffer(bytes(combined_pcm), sample_rate)
        
        # Save to file
        audio_path = os.path.join(PODCAST_DATA_DIR, f"{episode_id}.wav")
        with open(audio_path, 'wb') as f:
            f.write(wav_buffer)
        
        print(f"[PODCAST] Saved audio to {audio_path}")
        
    except Exception as e:
        print(f"[PODCAST] Error saving audio: {e}")


def create_wav_buffer(pcm_data, sample_rate):
    """Create WAV buffer from PCM data"""
    import struct
    
    num_channels = 1
    bits_per_sample = 16
    bytes_per_sample = bits_per_sample // 8
    block_align = num_channels * bytes_per_sample
    byte_rate = sample_rate * block_align
    data_size = len(pcm_data)
    
    buffer = io.BytesIO()
    
    # RIFF header
    buffer.write(b'RIFF')
    buffer.write(struct.pack('<I', 36 + data_size))
    buffer.write(b'WAVE')
    
    # fmt chunk
    buffer.write(b'fmt ')
    buffer.write(struct.pack('<I', 16))
    buffer.write(struct.pack('<H', 1))
    buffer.write(struct.pack('<H', num_channels))
    buffer.write(struct.pack('<I', sample_rate))
    buffer.write(struct.pack('<I', byte_rate))
    buffer.write(struct.pack('<H', block_align))
    buffer.write(struct.pack('<H', bits_per_sample))
    
    # data chunk
    buffer.write(b'data')
    buffer.write(struct.pack('<I', data_size))
    buffer.write(pcm_data)
    
    return buffer.getvalue()


@app.route('/api/podcast/regenerate-segment', methods=['POST'])
def regenerate_podcast_segment():
    """Regenerate audio for a specific segment"""
    data = request.get_json()
    
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400
    
    text = data.get('text', '')
    speaker = data.get('speaker', '')
    voice_id = data.get('voice_id')
    
    if not text:
        return jsonify({"success": False, "error": "Text is required"}), 400
    
    try:
        clean_text = remove_emojis(text)
        request_data = {"text": clean_text, "language": "en"}
        
        if voice_id:
            lookup_key = voice_id.replace(" (Custom)", "")
            if lookup_key in custom_voices:
                request_data["voice_clone_id"] = custom_voices[lookup_key].get("voice_clone_id", voice_id)
            else:
                request_data["voice_clone_id"] = voice_id
        
        response = requests.post(f"{TTS_BASE_URL}/tts", json=request_data, timeout=60)
        
        if response.status_code == 200:
            result = response.json()
            if result.get('success'):
                return jsonify({
                    "success": True,
                    "audio": result.get('audio', ''),
                    "sample_rate": result.get('sample_rate', TTS_SAMPLE_RATE)
                })
        
        return jsonify({"success": False, "error": "TTS failed"}), 500
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == '__main__':
    # Simple HTTP server
    print("\n" + "=" * 50)
    print("Running with HTTP on http://192.168.1.71:5000")
    print("=" * 50 + "\n")
    app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)
