import json
import re
import base64
from datetime import datetime
import numpy as np
from flask import Blueprint, request, jsonify, Response
import app.shared as shared
from app.providers import ChatMessage, ChatResponse

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
    clean_speaker = speaker.replace(" (Custom)", "").strip()
    voice_clone_id = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
    
    final_speaker = voice_clone_id
    if not final_speaker and clean_speaker and clean_speaker.lower() != 'default':
        final_speaker = clean_speaker
    
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
                # Call Provider directly instead of routing HTTP to ourselves (prevents deadlock)
                tts_provider = shared.get_tts_provider()
                if not tts_provider:
                    return None
                    
                if hasattr(tts_provider, 'generate_tts'):
                    result = tts_provider.generate_tts(text=clean_text, speaker=final_speaker, language="en")
                elif hasattr(tts_provider, 'generate_audio'):
                    result = tts_provider.generate_audio(text=clean_text, speaker=final_speaker, language="en")
                else:
                    return None
                    
                if result and result.get('success'):
                    return {
                        'audio': result.get('audio', ''),
                        'sample_rate': result.get('sample_rate', 24000)
                    }
            except Exception as e:
                import traceback
                print(f"[VOICE STREAM TTS ERROR] {e}")
                traceback.print_exc()
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

@chat_bp.route('/api/chat/streaming-conversation', methods=['POST'])
def chat_streaming_conversation():
    """Streaming conversation endpoint with full streaming pipeline."""
    data = request.get_json()
    session_id, user_message, model, messages, err, status = prepare_messages(data)
    if err:
        return err, status
    
    # Get providers
    provider = shared.get_provider()
    if not provider:
        return jsonify({"success": False, "error": "LLM provider not available"}), 500
    
    tts_provider = shared.get_tts_provider()
    if not tts_provider:
        return jsonify({"success": False, "error": "TTS provider not available"}), 500
    
    # Check if providers support streaming
    if not provider.supports_streaming():
        return jsonify({"success": False, "error": "LLM provider does not support streaming"}), 400
    
    if not tts_provider.supports_streaming():
        return jsonify({"success": False, "error": "TTS provider does not support streaming"}), 400
    
    # Get speaker configuration
    speaker = data.get('speaker', 'default')
    clean_speaker = speaker.replace(" (Custom)", "").strip()
    voice_clone_id = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
    
    final_speaker = voice_clone_id
    if not final_speaker and clean_speaker and clean_speaker.lower() != 'default':
        final_speaker = clean_speaker
    
    try:
        # Start LLM streaming
        stream_generator = provider.chat_completion(
            messages=messages,
            model=model or provider.config.model,
            stream=True
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to start LLM stream: {str(e)}"}), 500
    
    def generate():
        import asyncio
        import queue
        import threading
        
        # Buffer for accumulating tokens before sending to TTS
        token_buffer = ""
        sentence_buffer = ""
        sentence_idx = 0
        ai_message = ""
        thinking = ""
        
        # Queue for TTS processing
        tts_queue = queue.Queue()
        
        # Use a lock for thread-safe audio queue access
        import threading
        audio_queue_lock = threading.Lock()
        audio_chunks_list = []
        
        def tts_worker():
            """Background worker for TTS processing."""
            while True:
                try:
                    sentence = tts_queue.get(timeout=1)
                    if sentence is None:
                        break
                    
                    # Generate TTS audio
                    try:
                        if hasattr(tts_provider, 'generate_audio_stream'):
                            # Use streaming TTS if available
                            audio_chunks = []
                            sample_rate = 24000
                            for audio_chunk, sr, timing in tts_provider.generate_audio_stream(
                                text=sentence,
                                speaker=final_speaker,
                                language="English"
                            ):
                                if audio_chunk is not None and len(audio_chunk) > 0:
                                    audio_chunks.append(audio_chunk)
                                    sample_rate = sr
                            
                            # Combine audio chunks and convert to base64
                            if audio_chunks:
                                combined = np.concatenate(audio_chunks)
                                pcm_int16 = (combined * 32767).astype(np.int16).tobytes()
                                audio_b64 = base64.b64encode(pcm_int16).decode('utf-8')
                                
                                with audio_queue_lock:
                                    audio_chunks_list.append({
                                        'type': 'audio_chunk',
                                        'audio': audio_b64,
                                        'sample_rate': sample_rate,
                                        'text': sentence,
                                        'index': sentence_idx
                                    })
                        else:
                            # Fallback to batch TTS
                            if hasattr(tts_provider, 'generate_tts'):
                                result = tts_provider.generate_tts(text=sentence, speaker=final_speaker, language="en")
                            elif hasattr(tts_provider, 'generate_audio'):
                                result = tts_provider.generate_audio(text=sentence, speaker=final_speaker, language="en")
                            else:
                                continue
                            
                            if result and result.get('success'):
                                with audio_queue_lock:
                                    audio_chunks_list.append({
                                        'type': 'audio_chunk',
                                        'audio': result.get('audio', ''),
                                        'sample_rate': result.get('sample_rate', 24000),
                                        'text': sentence,
                                        'index': sentence_idx
                                    })
                    except Exception as e:
                        print(f"[STREAMING CONVERSATION TTS ERROR] {e}")
                    finally:
                        tts_queue.task_done()
                        
                except queue.Empty:
                    continue
                except Exception as e:
                    print(f"[STREAMING CONVERSATION TTS WORKER ERROR] {e}")
        
        # Start TTS worker thread
        tts_thread = threading.Thread(target=tts_worker, daemon=True)
        tts_thread.start()
        
        last_audio_idx = -1
        
        try:
            for response_chunk in stream_generator:
                if response_chunk.content:
                    token = response_chunk.content
                    ai_message += token
                    token_buffer += token
                    
                    # Accumulate tokens until we have a complete sentence
                    sentence_buffer += token
                    
                    # Check if we have a complete sentence
                    if any(char in sentence_buffer for char in '.!?。！？'):
                        # Clean up the sentence
                        sentence = sentence_buffer.strip()
                        if len(sentence) >= 10:  # Minimum sentence length
                            # Send to TTS worker
                            tts_queue.put(sentence)
                            sentence_buffer = ""
                            sentence_idx += 1
                        
                        yield f"data: {json.dumps({'type': 'content', 'content': token})}\n\n"
                
                if response_chunk.thinking or response_chunk.reasoning:
                    thinking += response_chunk.thinking or response_chunk.reasoning
                
                # Yield any new audio chunks that are ready
                with audio_queue_lock:
                    while len(audio_chunks_list) > last_audio_idx + 1:
                        last_audio_idx += 1
                        audio_data = audio_chunks_list[last_audio_idx]
                        yield f"data: {json.dumps(audio_data)}\n\n"
            
            # Process any remaining sentence buffer
            if sentence_buffer.strip():
                sentence = sentence_buffer.strip()
                if len(sentence) >= 10:
                    tts_queue.put(sentence)
                    sentence_idx += 1
            
            # Wait for all TTS tasks to complete
            tts_queue.join()
            
            # Signal TTS worker to stop
            tts_queue.put(None)
            tts_thread.join(timeout=5)
            
            # Yield any remaining audio chunks
            with audio_queue_lock:
                while len(audio_chunks_list) > last_audio_idx + 1:
                    last_audio_idx += 1
                    audio_data = audio_chunks_list[last_audio_idx]
                    yield f"data: {json.dumps(audio_data)}\n\n"
            
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
            
            yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        finally:
            # Clean up TTS worker
            try:
                # Clear any remaining items in queue
                while not tts_queue.empty():
                    tts_queue.get()
                    tts_queue.task_done()
                tts_queue.put(None)
            except:
                pass
    
    return Response(generate(), mimetype='text/event-stream')

@chat_bp.route('/api/conversation/greeting', methods=['POST'])
def conversation_greeting():
    """Generate a greeting when initially opening conversation mode."""
    data = request.get_json() or {}
    speaker = data.get('speaker', 'default')
    
    greeting_text = "Hello! I'm listening. How can I help you today?"
    
    try:
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({"success": False, "error": "No TTS provider"}), 500
            
        clean_speaker = speaker.replace(" (Custom)", "").strip()
        custom_vid = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
        final_speaker = custom_vid
        
        if not final_speaker and clean_speaker and clean_speaker.lower() != 'default':
            final_speaker = clean_speaker
            
        if hasattr(tts_provider, 'generate_tts'):
            result = tts_provider.generate_tts(text=greeting_text, speaker=final_speaker, language="en")
        elif hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(text=greeting_text, speaker=final_speaker, language="en")
        else:
            return jsonify({"success": False, "error": "Provider missing method"}), 500
            
        if result and result.get('success'):
            return jsonify({
                "success": True,
                "text": greeting_text,
                "audio": result.get('audio', ''),
                "sample_rate": result.get('sample_rate', 24000)
            })
        else:
            return jsonify({"success": False, "error": result.get('error', 'TTS failed')}), 500
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500