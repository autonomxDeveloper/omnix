import json
import requests
import re
from datetime import datetime
from flask import Blueprint, request, jsonify, Response
import app.shared as shared

chat_bp = Blueprint('chat', __name__)

def prepare_chat_request(data):
    if not data or 'message' not in data: return None, jsonify({"success": False, "error": "Message required"}), 400
    
    user_message, session_id, model = data['message'], data.get('session_id', 'default'), data.get('model', '')
    shared.sessions_data = shared.load_sessions()
    
    sys_prompt = shared.get_global_system_prompt()
    if session_id not in shared.sessions_data:
        shared.sessions_data[session_id] = {'title': 'New Chat', 'messages': [], 'system_prompt': sys_prompt, 'created_at': datetime.now().isoformat(), 'updated_at': datetime.now().isoformat()}
    
    messages = [{"role": "system", "content": data.get('system_prompt', sys_prompt)}]
    messages.extend([m for m in shared.sessions_data[session_id].get('messages', []) if m.get('role') != 'system'])
    messages.append({"role": "user", "content": user_message})
    shared.sessions_data[session_id]['messages'].append({"role": "user", "content": user_message})
    
    config = shared.get_provider_config()
    payload = {"model": model or config.get('model', 'local-model'), "messages": messages, "stream": False}
    headers = {"Content-Type": "application/json"}
    
    if config['provider'] in ['openrouter', 'cerebras']:
        headers["Authorization"] = f"Bearer {config['api_key']}"
        payload["max_tokens"] = config.get('thinking_budget', 0) or 4096
        if config['provider'] == 'openrouter':
            headers.update({"HTTP-Referer": "http://localhost:5000", "X-Title": "LM Studio Chatbot"})
            if config.get('thinking_budget', 0) > 0: payload["extra_options"] = {"max_tokens": config['thinking_budget']}
            
    url = f"{config['base_url']}/chat/completions" if config['provider'] == 'openrouter' else f"{config['base_url']}/v1/chat/completions"
    return (session_id, user_message, url, headers, payload, config), None, None

@chat_bp.route('/api/chat', methods=['POST'])
def chat():
    req_data, err, status = prepare_chat_request(request.get_json())
    if err: return err, status
    session_id, user_message, url, headers, payload, config = req_data
    
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=300)
        if r.status_code == 200:
            result = r.json()
            msg = result.get('choices', [{}])[0].get('message', {})
            content = msg.get('content', '')
            
            thinking, ai_message = msg.get('reasoning', ''), content
            if not thinking: thinking, ai_message = shared.extract_thinking(content)
            
            shared.sessions_data[session_id]['messages'].append({"role": "assistant", "content": ai_message, "thinking": thinking})
            if len(shared.sessions_data[session_id]['messages']) == 2: shared.sessions_data[session_id]['title'] = user_message[:30] + "..."
            shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
            shared.save_sessions(shared.sessions_data)
            
            usage = result.get('usage', {})
            return jsonify({"success": True, "response": ai_message, "thinking": thinking, "session_id": session_id, "tokens": usage})
        return jsonify({"success": False, "error": f"API error: {r.status_code}"}), r.status_code
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@chat_bp.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    req_data, err, status = prepare_chat_request(request.get_json())
    if err: return err, status
    session_id, user_message, url, headers, payload, config = req_data
    payload['stream'] = True

    def generate():
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=300, stream=True)
            if r.status_code == 200:
                ai_message, thinking = "", ""
                for line in r.iter_lines():
                    if line and line.decode('utf-8').startswith('data: '):
                        data_str = line.decode('utf-8')[6:]
                        if data_str.strip() == '[DONE]': break
                        try:
                            delta = json.loads(data_str).get('choices', [{}])[0].get('delta', {})
                            if config['provider'] == 'openrouter' and delta.get('reasoning'): thinking += delta['reasoning']
                            if content := delta.get('content', ''):
                                ai_message += content
                                yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"
                        except: continue
                
                if not thinking: thinking, ai_message = shared.extract_thinking(ai_message)
                shared.sessions_data[session_id]['messages'].append({"role": "assistant", "content": ai_message, "thinking": thinking})
                if len(shared.sessions_data[session_id]['messages']) == 2: shared.sessions_data[session_id]['title'] = user_message[:30] + "..."
                shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
                shared.save_sessions(shared.sessions_data)
                yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
            else: yield f"data: {json.dumps({'type': 'error', 'error': f'API error: {r.status_code}'})}\n\n"
        except Exception as e: yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    return Response(generate(), mimetype='text/event-stream')

@chat_bp.route('/api/chat/voice-stream', methods=['POST'])
def chat_voice_stream():
    data = request.get_json()
    req_data, err, status = prepare_chat_request(data)
    if err: return err, status
    session_id, user_message, url, headers, payload, config = req_data
    payload['stream'] = True
    
    speaker = data.get('speaker', 'default')
    voice_clone_id = shared.custom_voices.get(speaker.replace(" (Custom)", ""), {}).get("voice_clone_id")

    def generate():
        import time
        SENTENCE_ENDINGS = re.compile(r'[.!?]\s+|\n')
        MIN_TOKENS, MAX_TOKENS, MIN_SENTENCE = 15, 60, 15
        
        def generate_tts(sentence, index):
            clean_text = shared.remove_emojis(sentence)
            if not clean_text.strip(): return None
            try:
                req_data = {"text": clean_text, "language": "en"}
                if voice_clone_id: req_data["voice_clone_id"] = voice_clone_id
                resp = requests.post(f"{shared.TTS_BASE_URL}/tts", json=req_data, timeout=60)
                if resp.status_code == 200 and resp.json().get('success'):
                    return {'audio': resp.json().get('audio', ''), 'sample_rate': resp.json().get('sample_rate', shared.TTS_SAMPLE_RATE)}
            except: pass
            return None

        try:
            r = requests.post(url, json=payload, headers=headers, timeout=300, stream=True)
            if r.status_code != 200:
                yield f"data: {json.dumps({'type': 'error', 'error': f'API error: {r.status_code}'})}\n\n"
                return

            ai_message, thinking, buffer, sentence_idx, generated = "", "", "", 0, 0
            is_first, sent_first = True, False

            for line in r.iter_lines():
                if line and line.decode('utf-8').startswith('data: '):
                    data_str = line.decode('utf-8')[6:]
                    if data_str.strip() == '[DONE]': break
                    try:
                        delta = json.loads(data_str).get('choices', [{}])[0].get('delta', {})
                        if config['provider'] == 'openrouter' and delta.get('reasoning'): thinking += delta['reasoning']
                        if content := delta.get('content', ''):
                            ai_message += content
                            buffer += content
                            yield f"data: {json.dumps({'type': 'content', 'content': content})}\n\n"

                            chunks = []
                            if is_first and len(buffer) >= MIN_TOKENS:
                                split_idx = min(len(buffer), MAX_TOKENS)
                                last_space = buffer.rfind(' ', 0, split_idx)
                                split_idx = last_space if last_space > MIN_TOKENS else split_idx
                                chunks.append(buffer[:split_idx].strip())
                                buffer = buffer[split_idx:].lstrip()
                                is_first = False
                            else:
                                matches = list(SENTENCE_ENDINGS.finditer(buffer))
                                last_end = 0
                                for m in matches:
                                    sentence = buffer[last_end:m.end()].strip()
                                    if len(sentence) >= MIN_SENTENCE and not re.search(r'\b(Mr|Mrs|Ms|Dr|Sr|Jr)\.\s*$', sentence, re.IGNORECASE):
                                        chunks.append(sentence)
                                        last_end = m.end()
                                buffer = buffer[last_end:]

                            for chunk in chunks:
                                if tts_res := generate_tts(chunk, sentence_idx):
                                    generated += 1
                                    yield f"data: {json.dumps({'type': 'tts_sentence', 'index': sentence_idx, 'audio': tts_res['audio'], 'sample_rate': tts_res['sample_rate'], 'text': chunk, 'is_first': not sent_first})}\n\n"
                                    sent_first = True
                                sentence_idx += 1
                    except: continue

            if buffer.strip() and len(buffer.strip()) >= MIN_SENTENCE:
                if tts_res := generate_tts(buffer.strip(), sentence_idx):
                    generated += 1
                    yield f"data: {json.dumps({'type': 'tts_sentence', 'index': sentence_idx, 'audio': tts_res['audio'], 'sample_rate': tts_res['sample_rate'], 'text': buffer.strip()})}\n\n"

            if not thinking: thinking, ai_message = shared.extract_thinking(ai_message)
            shared.sessions_data[session_id]['messages'].append({"role": "assistant", "content": ai_message, "thinking": thinking})
            shared.save_sessions(shared.sessions_data)
            yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id, 'sentences_generated': generated})}\n\n"
        except Exception as e: yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')