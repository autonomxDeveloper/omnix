import os
import requests
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, send_from_directory
import app.shared as shared

core_bp = Blueprint('core', __name__)

@core_bp.route('/')
def index():
    return render_template('index.html')

@core_bp.route('/favicon.ico')
def favicon():
    return '', 204

@core_bp.route('/logo/<path:filename>')
def serve_logo(filename):
    return send_from_directory(os.path.join(shared.BASE_DIR, 'logo'), filename)

@core_bp.route('/api/settings', methods=['GET'])
def get_settings():
    settings = shared.load_settings()
    for key in ['openrouter', 'cerebras']:
        if settings.get(key, {}).get('api_key'):
            settings[key]['api_key'] = "***" + settings[key]['api_key'][-4:] if len(settings[key]['api_key']) > 4 else "****"
    return jsonify({"success": True, "settings": settings})

@core_bp.route('/api/settings', methods=['POST'])
def save_settings_endpoint():
    data = request.get_json()
    settings = shared.load_settings()
    
    if 'provider' in data: settings['provider'] = data['provider']
    if 'global_system_prompt' in data: settings['global_system_prompt'] = data['global_system_prompt']
    if 'lmstudio' in data: settings['lmstudio'].update(data['lmstudio'])
    
    for key in ['openrouter', 'cerebras']:
        if key in data:
            if key not in settings: settings[key] = {}
            if data[key].get('api_key') and not data[key]['api_key'].startswith('***'):
                settings[key]['api_key'] = data[key]['api_key']
            settings[key].update({k: v for k, v in data[key].items() if k != 'api_key'})
            
    auto_start = False
    llamacpp_model = ''
    if 'llamacpp' in data:
        if 'llamacpp' not in settings: settings['llamacpp'] = shared.DEFAULT_SETTINGS['llamacpp'].copy()
        settings['llamacpp'].update(data['llamacpp'])
        auto_start = data['llamacpp'].get('auto_start', False)
        llamacpp_model = settings['llamacpp'].get('model', '')
        
    shared.save_settings(settings)
    
    # Auto-start logic omitted for brevity (same logic exists in llamacpp.py /start endpoint)
    return jsonify({"success": True})

@core_bp.route('/api/openrouter/models', methods=['GET'])
def get_openrouter_models():
    api_key = shared.load_settings().get('openrouter', {}).get('api_key', '')
    if not api_key: return jsonify({"success": False, "error": "No API key"}), 400
    try:
        r = requests.get("https://openrouter.ai/api/v1/models", headers={"Authorization": f"Bearer {api_key}"}, timeout=10)
        return jsonify({"success": True, "models": [{'id': m.get('id'), 'name': m.get('name', m.get('id'))} for m in r.json().get('data', [])]}) if r.status_code == 200 else (jsonify({"success": False}), r.status_code)
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@core_bp.route('/api/cerebras/models', methods=['GET'])
def get_cerebras_models():
    api_key = shared.load_settings().get('cerebras', {}).get('api_key', '')
    if not api_key: return jsonify({"success": False, "error": "No API key"}), 400
    try:
        r = requests.get("https://api.cerebras.ai/v1/models", headers={"Authorization": f"Bearer {api_key}"}, timeout=15)
        return jsonify({"success": True, "models": [{'id': m.get('id'), 'name': m.get('name', m.get('id'))} for m in r.json().get('data', [])]}) if r.status_code == 200 else (jsonify({"success": False}), r.status_code)
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@core_bp.route('/api/models', methods=['GET'])
def get_models():
    settings = shared.load_settings()
    provider = settings.get('provider', 'lmstudio')
    
    if provider == 'openrouter': return jsonify({"success": True, "models": [settings.get('openrouter', {}).get('model', 'openai/gpt-4o-mini')]})
    if provider == 'cerebras': return jsonify({"success": True, "models": [settings.get('cerebras', {}).get('model', 'llama-3.3-70b-versatile')]})
    
    if provider == 'llamacpp':
        model = settings.get('llamacpp', {}).get('model', '')
        if model: return jsonify({"success": True, "models": [model]})
        models = []
        for d in ['llm', 'server']:
            p = os.path.join(shared.BASE_DIR, 'models', d)
            if os.path.exists(p):
                models.extend([f for f in os.listdir(p) if f.lower().endswith('.gguf') and f not in models])
        return jsonify({"success": True, "models": models})
        
    base_url = settings.get('lmstudio', {}).get('base_url', 'http://localhost:1234')
    try:
        r = requests.get(f"{base_url}/v1/models", timeout=5)
        if r.status_code == 200: return jsonify({"success": True, "models": [i['id'] for i in r.json().get('data', []) if i.get('id')]})
        r = requests.get(f"{base_url}/api/v0/models", timeout=5)
        return jsonify({"success": True, "models": [i.get('id') or i.get('model') for i in r.json() if isinstance(i, dict)]})
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 200

@core_bp.route('/api/sessions', methods=['GET', 'POST'])
def handle_sessions():
    shared.sessions_data = shared.load_sessions()
    if request.method == 'GET':
        sl = sorted([{'id': k, 'title': v.get('title', 'New Chat'), 'updated_at': v.get('updated_at', '')} for k, v in shared.sessions_data.items()], key=lambda x: x['updated_at'], reverse=True)
        return jsonify({"success": True, "sessions": sl})
        
    import uuid
    sid = str(uuid.uuid4())[:8]
    shared.sessions_data[sid] = {'title': 'New Chat', 'messages': [], 'system_prompt': shared.get_global_system_prompt(), 'created_at': datetime.now().isoformat(), 'updated_at': datetime.now().isoformat()}
    shared.save_sessions(shared.sessions_data)
    return jsonify({"success": True, "session_id": sid})

@core_bp.route('/api/sessions/<session_id>', methods=['GET', 'DELETE', 'PUT'])
def handle_session(session_id):
    shared.sessions_data = shared.load_sessions()
    if session_id not in shared.sessions_data: return jsonify({"success": False, "error": "Not found"}), 404
    
    if request.method == 'GET': return jsonify({"success": True, "session": shared.sessions_data[session_id]})
    elif request.method == 'DELETE':
        del shared.sessions_data[session_id]
        shared.save_sessions(shared.sessions_data)
        return jsonify({"success": True})
    elif request.method == 'PUT':
        data = request.get_json()
        if 'title' in data: shared.sessions_data[session_id]['title'] = data['title']
        if 'system_prompt' in data: shared.sessions_data[session_id]['system_prompt'] = data['system_prompt']
        shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
        shared.save_sessions(shared.sessions_data)
        return jsonify({"success": True})

@core_bp.route('/api/clear', methods=['POST'])
def clear_session():
    sid = request.get_json().get('session_id', 'default')
    shared.sessions_data = shared.load_sessions()
    if sid in shared.sessions_data:
        shared.sessions_data[sid]['messages'] = []
        shared.sessions_data[sid]['updated_at'] = datetime.now().isoformat()
        shared.save_sessions(shared.sessions_data)
    return jsonify({"success": True})

@core_bp.route('/api/health', methods=['GET'])
def health_check():
    config = shared.get_provider_config()
    try:
        if config['provider'] in ['openrouter', 'cerebras']:
            return jsonify({"status": "connected" if config.get('api_key') else "disconnected", "provider": config['provider']})
        r = requests.get(f"{config['base_url']}/v1/models", timeout=5)
        return jsonify({"status": "connected" if r.status_code == 200 else "disconnected", "provider": config['provider']})
    except Exception as e: return jsonify({"status": "disconnected", "message": str(e)}), 200