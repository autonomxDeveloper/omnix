import os
import json
import base64
import requests
import io
import wave
import numpy as np
from flask import Blueprint, request, jsonify, Response
import app.shared as shared

audio_bp = Blueprint('audio', __name__)

@audio_bp.route('/api/voice_clones', methods=['GET'])
def get_voice_clones():
    return jsonify({"success": True, "voices": [{"id": k, "language": v.get("language", "en"), "has_audio": v.get("has_audio", False)} for k, v in shared.custom_voices.items()]})

@audio_bp.route('/api/voice_clones/<voice_id>', methods=['DELETE'])
def delete_voice_clone(voice_id):
    if voice_id not in shared.custom_voices: return jsonify({"success": False, "error": "Not found"}), 404
    if shared.custom_voices[voice_id].get("has_audio"):
        try:
            # Use provider system for voice clone deletion
            tts_provider = shared.get_tts_provider()
            if tts_provider and hasattr(tts_provider, 'voice_clone'):
                # Try to delete via provider if it supports it
                pass  # Most providers don't have delete functionality, so we'll skip this
        except: pass
    del shared.custom_voices[voice_id]
    with open(shared.VOICE_CLONES_FILE, 'w') as f: json.dump(shared.custom_voices, f, indent=2)
    return jsonify({"success": True})

@audio_bp.route('/api/voice_clone', methods=['POST'])
def create_voice_clone():
    v_name = request.form.get('name', '').strip() or request.form.get('voice_id', '').strip()
    if not v_name: return jsonify({"success": False, "error": "Name required"}), 400
    
    a_file = request.files.get('audio') or request.files.get('file')
    has_audio = False
    if a_file:
        try:
            # Use provider system for voice cloning
            tts_provider = shared.get_tts_provider()
            if tts_provider and hasattr(tts_provider, 'voice_clone'):
                audio_data = a_file.read()
                result = tts_provider.voice_clone(
                    voice_id=v_name,
                    audio_data=audio_data,
                    ref_text=request.form.get('ref_text', '')
                )
                has_audio = result.get('success', False)
                if not has_audio:
                    print(f"Voice clone failed: {result.get('message', 'Unknown error')}")
            else:
                return jsonify({"success": False, "error": "TTS provider does not support voice cloning"}), 500
        except Exception as e:
            print(f"Voice clone error: {e}")
            return jsonify({"success": False, "error": f"Voice clone failed: {str(e)}"}), 500
        
    shared.custom_voices[v_name] = {"speaker": "default", "language": request.form.get('language', 'en'), "voice_clone_id": v_name, "has_audio": has_audio}
    with open(shared.VOICE_CLONES_FILE, 'w') as f: json.dump(shared.custom_voices, f, indent=2)
    return jsonify({"success": True, "voice_id": v_name})

@audio_bp.route('/api/tts', methods=['POST'])
def tts():
    print('[TTS-BACKEND] === TTS ENDPOINT CALLED ===')
    data = request.get_json()
    print(f'[TTS-BACKEND] Request data: {data}')
    
    text = shared.remove_emojis(data.get('text', ''))
    print(f'[TTS-BACKEND] Cleaned text: "{text[:50]}..."')
    
    if not text: 
        print('[TTS-BACKEND] Empty text received')
        return jsonify({"success": False, "error": "Text required"}), 400
    
    # Log the raw speaker value before processing
    raw_speaker = data.get('speaker', 'default')
    print(f'[TTS-BACKEND] Raw speaker from request: "{raw_speaker}"')
    
    speaker = raw_speaker.replace(" (Custom)", "")
    language = data.get('language', 'en')
    vid = shared.custom_voices.get(speaker, {}).get("voice_clone_id")
    
    print(f'[TTS-BACKEND] Processed speaker: "{speaker}", Language: {language}, Voice ID: {vid}')
    
    try:
        # Use provider system for TTS
        print('[TTS-BACKEND] Getting TTS provider...')
        tts_provider = shared.get_tts_provider()
        print(f'[TTS-BACKEND] TTS provider: {tts_provider}')
        
        if tts_provider and hasattr(tts_provider, 'generate_audio'):
            print('[TTS-BACKEND] Calling provider.generate_audio...')
            result = tts_provider.generate_audio(
                text=text,
                speaker=vid if vid else None,
                language=language
            )
            print(f'[TTS-BACKEND] Provider result: {result}')
            
            if result.get('success'):
                audio_b64 = result.get('audio', '')
                sample_rate = result.get('sample_rate', 24000)  # Use provider's sample rate
                audio_length = len(audio_b64) if audio_b64 else 0
                print(f'[TTS-BACKEND] SUCCESS: Generated audio {audio_length} bytes, sample_rate: {sample_rate}')
                
                return jsonify({
                    "success": True, 
                    "audio": audio_b64, 
                    "sample_rate": sample_rate, 
                    "format": result.get('format', 'audio/wav')
                })
            else:
                error_msg = result.get('error', 'TTS generation failed')
                print(f'[TTS-BACKEND] Provider failed: {error_msg}')
                return jsonify({"success": False, "error": error_msg}), 500
        else:
            print('[TTS-BACKEND] No TTS provider available or no generate_audio method')
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
            
    except Exception as e: 
        print(f'[TTS-BACKEND] Exception: {e}')
        import traceback
        print(f'[TTS-BACKEND] Traceback: {traceback.format_exc()}')
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/stream', methods=['POST'])
def tts_stream():
    """Streaming TTS endpoint - returns audio stream directly."""
    data = request.get_json()
    text = shared.remove_emojis(data.get('text', ''))
    if not text: return jsonify({"success": False, "error": "Text required"}), 400
    
    speaker = data.get('speaker', 'default').replace(" (Custom)", "")
    language = data.get('language', 'en')
    vid = shared.custom_voices.get(speaker, {}).get("voice_clone_id")
    
    try:
        # Use provider system for TTS
        tts_provider = shared.get_tts_provider()
        if tts_provider and hasattr(tts_provider, 'generate_audio'):
            # Use provider system
            result = tts_provider.generate_audio(
                text=text,
                speaker=vid if vid else None,
                language=language
            )
            if result.get('success'):
                audio_b64 = result.get('audio', '')
                if audio_b64:
                    # Decode base64 audio and return as stream
                    audio_data = base64.b64decode(audio_b64)
                    return Response(
                        audio_data,
                        mimetype='audio/wav',
                        headers={'Content-Disposition': 'attachment; filename=tts.wav'}
                    )
                else:
                    return jsonify({"success": False, "error": "No audio data returned"}), 500
            else:
                error_msg = result.get('error', 'TTS generation failed')
                return jsonify({"success": False, "error": error_msg}), 500
        else:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
            
    except Exception as e: 
        print(f"TTS streaming error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/speakers', methods=['GET'])
def get_speakers():
    speakers, seen = [], set()
    try:
        # Use provider system to get speakers
        tts_provider = shared.get_tts_provider()
        if tts_provider and hasattr(tts_provider, 'get_speakers'):
            provider_speakers = tts_provider.get_speakers()
            for speaker in provider_speakers:
                if speaker['id'] not in seen:
                    seen.add(speaker['id'])
                    speakers.append({
                        "id": speaker['id'], 
                        "name": speaker['name'], 
                        "language": speaker.get('language', 'en'), 
                        "source": "provider"
                    })
    except Exception as e:
        print(f"Error getting speakers from provider: {e}")
        # Fallback to empty list
    
    # Add custom voices
    for k, v in shared.custom_voices.items():
        if k not in seen:
            seen.add(k)
            speakers.append({
                "id": k, 
                "name": k, 
                "language": v.get("language", "en"), 
                "is_custom": v.get("is_preloaded", False)
            })
    
    return jsonify({"success": True, "speakers": speakers})

@audio_bp.route('/api/stt', methods=['POST'])
def stt():
    if 'audio' not in request.files: return jsonify({"success": False, "error": "No audio file"}), 400
    a_file = request.files['audio']
    a_data = a_file.read()
    if len(a_data) < 100: return jsonify({"success": False, "error": "Audio too small"}), 400
    
    try:
        # Use provider system for STT
        stt_provider = shared.get_stt_provider()
        if stt_provider and hasattr(stt_provider, 'transcribe'):
            # Use provider system
            import tempfile
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_file.write(a_data)
                temp_file_path = temp_file.name
            
            try:
                result = stt_provider.transcribe(
                    audio_file_path=temp_file_path,
                    language=request.form.get('language', 'en')
                )
                os.unlink(temp_file_path)  # Clean up temp file
                
                if result.get('success'):
                    return jsonify({
                        "success": True, 
                        "text": result.get('text', ''), 
                        "segments": result.get('segments', []), 
                        "duration": result.get('duration')
                    })
                else:
                    error_msg = result.get('error', 'STT transcription failed')
                    return jsonify({"success": False, "error": error_msg}), 500
            except Exception as e:
                if 'temp_file_path' in locals():
                    try: os.unlink(temp_file_path)
                    except: pass
                raise e
        else:
            return jsonify({"success": False, "error": "No STT provider available"}), 500
            
    except Exception as e: 
        print(f"STT error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/stt/float32', methods=['POST'])
def stt_float32():
    try:
        sr = int(request.headers.get('X-Sample-Rate', 48000))
        f32_data = request.get_data()
        if len(f32_data) < 100: return jsonify({"success": False, "error": "Too small"}), 400
        
        arr = np.frombuffer(f32_data, dtype=np.float32)
        if sr != 16000:
            ratio = 16000 / sr
            idx = np.clip(np.arange(int(len(arr) * ratio)) / ratio, 0, len(arr) - 1)
            arr = np.interp(idx, np.arange(len(arr)), arr)
            
        int16_arr = np.clip(arr * 32767, -32768, 32767).astype(np.int16)
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wf:
            wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000); wf.writeframes(int16_arr.tobytes())
        
        # Use provider system for STT
        stt_provider = shared.get_stt_provider()
        if stt_provider and hasattr(stt_provider, 'transcribe_raw'):
            # Use provider system
            result = stt_provider.transcribe_raw(
                audio_data=wav_io.getvalue(),
                sample_rate=16000,
                language=request.headers.get('X-Language', 'en')
            )
            if result.get('success'):
                return jsonify({
                    "success": True, 
                    "text": result.get('text', ''), 
                    "segments": result.get('segments', [])
                })
            else:
                error_msg = result.get('error', 'STT transcription failed')
                return jsonify({"success": False, "error": error_msg}), 500
        else:
            return jsonify({"success": False, "error": "No STT provider available"}), 500
            
    except Exception as e: 
        print(f"STT float32 error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

# NEW: Health check endpoint for TTS provider
@audio_bp.route('/api/tts/health', methods=['GET'])
def tts_health_check():
    """Check if TTS provider is available and healthy."""
    try:
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({
                "success": False, 
                "error": "No TTS provider configured",
                "provider": None
            }), 500
        
        # Try to get speakers as a health check
        if hasattr(tts_provider, 'get_speakers'):
            speakers = tts_provider.get_speakers()
            return jsonify({
                "success": True,
                "provider": getattr(tts_provider, 'provider_name', 'unknown'),
                "speakers_count": len(speakers),
                "speakers": speakers[:5]  # Return first 5 speakers
            })
        else:
            return jsonify({
                "success": True,
                "provider": getattr(tts_provider, 'provider_name', 'unknown'),
                "message": "Provider available but no speaker list method"
            })
            
    except Exception as e:
        print(f"TTS health check failed: {e}")
        return jsonify({
            "success": False, 
            "error": str(e),
            "provider": getattr(tts_provider, 'provider_name', 'unknown') if 'tts_provider' in locals() else None
        }), 500

# NEW: Test TTS endpoint for debugging
@audio_bp.route('/api/tts/test', methods=['POST'])
def tts_test():
    """Test TTS generation with a simple text."""
    try:
        data = request.get_json()
        text = data.get('text', 'Hello, this is a test.')
        speaker = data.get('speaker', 'default')
        language = data.get('language', 'en')
        
        print(f"[TTS-TEST] Testing with text: '{text[:50]}...', speaker: {speaker}, language: {language}")
        
        # Use provider system for TTS
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
        
        print(f"[TTS-TEST] Using provider: {getattr(tts_provider, 'provider_name', 'unknown')}")
        
        if hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(
                text=text,
                speaker=speaker if speaker != 'default' else None,
                language=language
            )
            print(f"[TTS-TEST] Provider result: {result.get('success', False)}")
            
            if result.get('success'):
                audio_b64 = result.get('audio', '')
                sample_rate = result.get('sample_rate', 24000)
                audio_length = len(audio_b64) if audio_b64 else 0
                
                print(f"[TTS-TEST] Generated audio: {audio_length} bytes, sample_rate: {sample_rate}")
                
                return jsonify({
                    "success": True, 
                    "audio": audio_b64, 
                    "sample_rate": sample_rate, 
                    "format": result.get('format', 'audio/wav'),
                    "text": text,
                    "provider": getattr(tts_provider, 'provider_name', 'unknown')
                })
            else:
                error_msg = result.get('error', 'TTS generation failed')
                print(f"[TTS-TEST] Provider error: {error_msg}")
                return jsonify({"success": False, "error": error_msg}), 500
        else:
            return jsonify({"success": False, "error": "TTS provider does not support generate_audio method"}), 500
            
    except Exception as e: 
        print(f"[TTS-TEST] Error: {e}")
        import traceback
        print(f"[TTS-TEST] Traceback: {traceback.format_exc()}")
        return jsonify({"success": False, "error": str(e)}), 500

# NEW: Provider status endpoint
@audio_bp.route('/api/providers/status', methods=['GET'])
def providers_status():
    """Get status of all audio providers."""
    try:
        # Check TTS provider
        tts_status = {"available": False, "provider": None, "error": None}
        try:
            tts_provider = shared.get_tts_provider()
            if tts_provider:
                tts_status["available"] = True
                tts_status["provider"] = getattr(tts_provider, 'provider_name', 'unknown')
                if hasattr(tts_provider, 'health_check'):
                    tts_status["healthy"] = tts_provider.health_check()
                if hasattr(tts_provider, 'get_speakers'):
                    tts_status["speakers"] = len(tts_provider.get_speakers())
        except Exception as e:
            tts_status["error"] = str(e)
        
        # Check STT provider
        stt_status = {"available": False, "provider": None, "error": None}
        try:
            stt_provider = shared.get_stt_provider()
            if stt_provider:
                stt_status["available"] = True
                stt_status["provider"] = getattr(stt_provider, 'provider_name', 'unknown')
                if hasattr(stt_provider, 'health_check'):
                    stt_status["healthy"] = stt_provider.health_check()
        except Exception as e:
            stt_status["error"] = str(e)
        
        return jsonify({
            "success": True,
            "tts": tts_status,
            "stt": stt_status,
            "settings": shared.load_settings().get('audio_provider_tts', 'chatterbox')
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500