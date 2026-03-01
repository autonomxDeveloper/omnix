
import json
import re
from datetime import datetime
from flask import Blueprint, request, jsonify, Response
import app.shared as shared
from app.providers import ChatMessage, ChatResponse
import requests

chat_bp = Blueprint('chat', __name__)

def prepare_messages(data):
    """Prepare chat messages from request data."""
    if not data or 'message' not in data:
        return None, jsonify({"success": False, "error": "Message required"}), 400
    
    user_message = data['message']
    session_id = data.get('session_id', 'default')
    model = data.get('model', '')
    system_prompt = data.get('system_prompt', shared.get_global_system_prompt())
    
    shared.sessions_data = shared.load_sessions()
    
    if session_id not in shared.sessions_data:
        shared.sessions_data[session_id] = {
            'title': 'New Chat',
            'messages': [],
            'system_prompt': system_prompt,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
    
    # Build message list
    messages = [ChatMessage(role="system", content=system_prompt)]
    messages.extend([
        ChatMessage(role=m["role"], content=m["content"])
        for m in shared.sessions_data[session_id].get('messages', [])
        if m.get('role') != 'system'
    ])
    messages.append(ChatMessage(role="user", content=user_message))
    
    # Save user message to session
    shared.sessions_data[session_id]['messages'].append({
        "role": "user",
        "content": user_message
    })
    
    return session_id, user_message, model, messages, None, None

@chat_bp.route('/api/chat', methods=['POST'])
def chat():
    """Non-streaming chat endpoint."""
    session_id, user_message, model, messages, err, status = prepare_messages(request.get_json())
    if err:
        return err, status
    
    # Get provider
    provider = shared.get_provider()
    if not provider:
        return jsonify({"success": False, "error": "Provider not available"}), 500
    
    try:
        # Call provider
        response = provider.chat_completion(
            messages=messages,
            model=model or provider.config.model,
            stream=False
        )
        
        # Extract content and thinking
        content = response.content
        thinking = response.thinking or response.reasoning or ""
        
        # Save assistant message to session
        shared.sessions_data[session_id]['messages'].append({
            "role": "assistant",
            "content": content,
            "thinking": thinking
        })
        
        # Update session title if it's the first response
        if len(shared.sessions_data[session_id]['messages']) == 2:
            shared.sessions_data[session_id]['title'] = user_message[:30] + "..."
        
        shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
        shared.save_sessions(shared.sessions_data)
        
        return jsonify({
            "success": True,
            "response": content,
            "thinking": thinking,
            "session_id": session_id,
            "tokens": response.usage
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@chat_bp.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """Streaming chat endpoint."""
    session_id, user_message, model, messages, err, status = prepare_messages(request.get_json())
    if err:
        return err, status
    
    # Get provider
    provider = shared.get_provider()
    if not provider:
        return jsonify({"success": False, "error": "Provider not available"}), 500
    
    # Check if provider supports streaming
    if not provider.supports_streaming():
        return jsonify({"success": False, "error": "Provider does not support streaming"}), 400
    
    try:
        stream_generator = provider.chat_completion(
            messages=messages,
            model=model or provider.config.model,
            stream=True
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to start stream: {str(e)}"}), 500
    
    def generate():
        try:
            ai_message = ""
            thinking = ""
            
            for response_chunk in stream_generator:
                if response_chunk.content:
                    ai_message += response_chunk.content
                    yield f"data: {json.dumps({'type': 'content', 'content': response_chunk.content})}\n\n"
                
                if response_chunk.thinking or response_chunk.reasoning:
                    thinking += response_chunk.thinking or response_chunk.reasoning
            
            # Save assistant message to session
            shared.sessions_data[session_id]['messages'].append({
                "role": "assistant",
                "content": ai_message,
                "thinking": thinking
            })
            
            if len(shared.sessions_data[session_id]['messages']) == 2:
                shared.sessions_data[session_id]['title'] = user_message[:30] + "..."
            
            shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
            shared.save_sessions(shared.sessions_data)
            
            yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')

@chat_bp.route('/api/chat/voice-stream', methods=['POST'])
def chat_voice_stream():
    """Voice-streaming chat endpoint with TTS integration."""
    data = request.get_json()
    session_id, user_message, model, messages, err, status = prepare_messages(data)
    if err:
        return err, status
    
    # Get provider
    provider = shared.get_provider()
    if not provider:
        return jsonify({"success": False, "error": "Provider not available"}), 500
    
    # Check if provider supports streaming
    if not provider.supports_streaming():
        return jsonify({"success": False, "error": "Provider does not support streaming"}), 400
    
    # Get raw speaker string
    speaker = data.get('speaker', 'default')
    # Resolve custom voice if any
    clean_speaker = speaker.replace(" (Custom)", "")
    voice_clone_id = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
    
    try:
        stream_generator = provider.chat_completion(
            messages=messages,
            model=model or provider.config.model,
            stream=True
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to start stream: {str(e)}"}), 500
    
    def generate():
        import time
        SENTENCE_ENDINGS = re.compile(r'[.!?]\s+|\n')
        MIN_TOKENS, MAX_TOKENS, MIN_SENTENCE = 15, 60, 15
        
        def generate_tts(sentence, index):
            clean_text = shared.remove_emojis(sentence)
            if not clean_text.strip():
                return None
            try:
                req_data = {
                    "text": clean_text, 
                    "language": "en",
                    "speaker": speaker  # Pass raw speaker string for audio.py resolution
                }
                
                # If we definitely know it's a custom voice, include ID
                if voice_clone_id:
                    req_data["voice_clone_id"] = voice_clone_id
                    
                resp = requests.post(f"{shared.TTS_BASE_URL}/tts", json=req_data, timeout=60)
                if resp.status_code == 200 and resp.json().get('success'):
                    return {
                        'audio': resp.json().get('audio', ''),
                        'sample_rate': resp.json().get('sample_rate', shared.TTS_SAMPLE_RATE)
                    }
            except:
                pass
            return None
        
        try:
            ai_message = ""
            thinking = ""
            buffer = ""
            sentence_idx = 0
            generated = 0
            is_first = True
            sent_first = False
            
            for response_chunk in stream_generator:
                if response_chunk.content:
                    ai_message += response_chunk.content
                    buffer += response_chunk.content
                    yield f"data: {json.dumps({'type': 'content', 'content': response_chunk.content})}\n\n"
                    
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
                
                if response_chunk.thinking or response_chunk.reasoning:
                    thinking += response_chunk.thinking or response_chunk.reasoning
            
            # Handle remaining buffer
            if buffer.strip() and len(buffer.strip()) >= MIN_SENTENCE:
                if tts_res := generate_tts(buffer.strip(), sentence_idx):
                    generated += 1
                    yield f"data: {json.dumps({'type': 'tts_sentence', 'index': sentence_idx, 'audio': tts_res['audio'], 'sample_rate': tts_res['sample_rate'], 'text': buffer.strip()})}\n\n"
            
            # Extract thinking from content if not already captured
            if not thinking:
                thinking, ai_message = shared.extract_thinking(ai_message)
            
            # Save assistant message
            shared.sessions_data[session_id]['messages'].append({
                "role": "assistant",
                "content": ai_message,
                "thinking": thinking
            })
            shared.save_sessions(shared.sessions_data)
            
            yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id, 'sentences_generated': generated})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
    
    return Response(generate(), mimetype='text/event-stream')