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
                sample_rate = result.get('sample_rate', 24000)  # Use provider's sample rate
                return jsonify({
                    "success": True, 
                    "audio": audio_b64, 
                    "sample_rate": sample_rate, 
                    "format": result.get('format', 'audio/wav')
                })
            else:
                error_msg = result.get('error', 'TTS generation failed')
                print(f"TTS generation failed: {error_msg}")
                return jsonify({"success": False, "error": error_msg}), 500
        else:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
            
    except Exception as e: 
        print(f"TTS error: {e}")
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
