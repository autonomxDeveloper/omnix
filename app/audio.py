import os
import json
import base64
import requests
import io
import wave
import numpy as np
import traceback
import subprocess
import tempfile
import shutil
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
            tts_provider = shared.get_tts_provider()
            if tts_provider and hasattr(tts_provider, 'voice_clone'):
                pass 
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

def resolve_speaker(data):
    raw_speaker = data.get('speaker', 'default')
    clean_speaker = raw_speaker.replace(" (Custom)", "").strip()
    custom_vid = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
    provided_vid = data.get('voice_clone_id')
    
    final_speaker = custom_vid or provided_vid
    if not final_speaker and clean_speaker and clean_speaker.lower() != 'default':
        final_speaker = clean_speaker
        
    print(f"[AUDIO-DEBUG] Resolving Speaker: Raw='{raw_speaker}' -> Clean='{clean_speaker}' -> Final='{final_speaker}'")
    return final_speaker, data.get('language', 'en')

@audio_bp.route('/api/tts', methods=['POST'])
def tts():
    data = request.get_json()
    text = shared.remove_emojis(data.get('text', ''))
    if not text: return jsonify({"success": False, "error": "Text required"}), 400
    
    final_speaker, language = resolve_speaker(data)
    
    try:
        tts_provider = shared.get_tts_provider()
        if tts_provider and hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(
                text=text,
                speaker=final_speaker,
                language=language
            )
            if result.get('success'):
                return jsonify({
                    "success": True, 
                    "audio": result.get('audio', ''), 
                    "sample_rate": result.get('sample_rate', 24000), 
                    "format": result.get('format', 'audio/wav')
                })
            else:
                return jsonify({"success": False, "error": result.get('error', 'TTS generation failed')}), 500
        else:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
    except Exception as e: 
        print(f"[TTS-ERROR] {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/stream', methods=['POST'])
def tts_stream():
    data = request.get_json()
    text = shared.remove_emojis(data.get('text', ''))
    if not text: return jsonify({"success": False, "error": "Text required"}), 400
    
    final_speaker, language = resolve_speaker(data)
    
    try:
        tts_provider = shared.get_tts_provider()
        if tts_provider and hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(
                text=text,
                speaker=final_speaker,
                language=language
            )
            if result.get('success'):
                audio_b64 = result.get('audio', '')
                if audio_b64:
                    audio_data = base64.b64decode(audio_b64)
                    return Response(
                        audio_data,
                        mimetype='audio/wav',
                        headers={'Content-Disposition': 'attachment; filename=tts.wav'}
                    )
                else:
                    return jsonify({"success": False, "error": "No audio data returned"}), 500
            else:
                return jsonify({"success": False, "error": result.get('error', 'TTS failed')}), 500
        else:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
    except Exception as e: 
        print(f"[TTS-STREAM-ERROR] {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/speakers', methods=['GET'])
def get_speakers():
    speakers, seen = [], set()
    try:
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
        stt_provider = shared.get_stt_provider()
        if stt_provider and hasattr(stt_provider, 'transcribe'):
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as temp_in:
                temp_in.write(a_data)
                temp_in_path = temp_in.name
                
            temp_wav_path = temp_in_path + "_16k.wav"
            target_file_path = temp_in_path
            
            try:
                # Force strictly 16kHz Mono WAV using ffmpeg for Parakeet
                subprocess.run([
                    'ffmpeg', '-y', '-i', temp_in_path,
                    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
                    temp_wav_path
                ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                target_file_path = temp_wav_path
            except Exception as e:
                print(f"[STT] ffmpeg conversion failed or not installed, falling back to raw bytes: {e}")
                with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_out:
                    temp_out.write(a_data)
                    target_file_path = temp_out.name
            
            try:
                # ================= DEBUG AUDIO SAVING =================
                debug_path = os.path.join(shared.BASE_DIR, 'debug_stt_standard.wav')
                shutil.copy2(target_file_path, debug_path)
                print(f"[DEBUG STT] Saved audio what Parakeet sees to: {debug_path}")
                # ======================================================

                result = stt_provider.transcribe(
                    audio_file_path=target_file_path,
                    language=request.form.get('language', 'en')
                )
                
                # Cleanup temp files
                for p in [temp_in_path, temp_wav_path, target_file_path]:
                    try:
                        if os.path.exists(p): os.unlink(p)
                    except: pass
                
                if result.get('success'):
                    return jsonify({
                        "success": True, 
                        "text": result.get('text', ''), 
                        "segments": result.get('segments', []), 
                        "duration": result.get('duration')
                    })
                else:
                    return jsonify({"success": False, "error": result.get('error', 'STT failed')}), 500
            except Exception as e:
                for p in [temp_in_path, temp_wav_path, target_file_path]:
                    try:
                        if os.path.exists(p): os.unlink(p)
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
        print("[STT-FLOAT32] Received request")
        sr_header = request.headers.get('X-Sample-Rate', '48000')
        sr = int(float(sr_header))
        print(f"[STT-FLOAT32] Received sample rate: {sr}")
        
        f32_data = request.get_data()
        data_len = len(f32_data)
        
        if data_len < 100: 
            return jsonify({"success": False, "error": "Too small"}), 400
        
        # Ensure data length is multiple of 4
        remainder = data_len % 4
        if remainder != 0:
            f32_data = f32_data[:-remainder]
        
        arr = np.frombuffer(f32_data, dtype=np.float32)
        
        # Proper Resampling logic
        target_sr = 16000
        if sr != target_sr:
            print(f"[STT-FLOAT32] Resampling from {sr} to {target_sr}")
            try:
                # 1st Choice: High-quality Scipy Resampler
                import scipy.signal
                num_samples = int(len(arr) * target_sr / sr)
                arr = scipy.signal.resample(arr, num_samples)
            except ImportError:
                try:
                    # 2nd Choice: Librosa
                    import librosa
                    arr = librosa.resample(arr, orig_sr=sr, target_sr=target_sr)
                except ImportError:
                    # 3rd Choice: Anti-aliased moving average fallback
                    print(f"[STT-FLOAT32] Warning: Using low-quality fallback resampler")
                    ratio = int(sr / target_sr)
                    if ratio > 1 and sr % target_sr == 0:
                        window = np.ones(ratio) / ratio
                        arr = np.convolve(arr, window, mode='same')[::ratio]
                    else:
                        duration = len(arr) / sr
                        target_length = int(duration * target_sr)
                        x_old = np.linspace(0, duration, len(arr))
                        x_new = np.linspace(0, duration, target_length)
                        arr = np.interp(x_new, x_old, arr)
            
        # Convert float32 [-1, 1] to int16
        int16_arr = np.clip(arr * 32767, -32768, 32767).astype(np.int16)
        
        wav_io = io.BytesIO()
        with wave.open(wav_io, 'wb') as wf:
            wf.setnchannels(1) 
            wf.setsampwidth(2) 
            wf.setframerate(target_sr) 
            wf.writeframes(int16_arr.tobytes())
            
        # ================= DEBUG AUDIO SAVING =================
        debug_path = os.path.join(shared.BASE_DIR, 'debug_stt_float32.wav')
        with open(debug_path, 'wb') as f:
            f.write(wav_io.getvalue())
        print(f"[DEBUG STT] Saved float32 audio what Parakeet sees to: {debug_path}")
        # ======================================================
        
        stt_provider = shared.get_stt_provider()
        if stt_provider and hasattr(stt_provider, 'transcribe_raw'):
            result = stt_provider.transcribe_raw(
                audio_data=wav_io.getvalue(),
                sample_rate=target_sr,
                language=request.headers.get('X-Language', 'en')
            )
            
            if result.get('success'):
                return jsonify({
                    "success": True, 
                    "text": result.get('text', ''), 
                    "segments": result.get('segments', [])
                })
            else:
                return jsonify({"success": False, "error": result.get('error', 'STT failed')}), 500
        else:
            return jsonify({"success": False, "error": "No STT provider available"}), 500
            
    except Exception as e: 
        print(f"[STT-FLOAT32] Exception: {e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/health', methods=['GET'])
def tts_health_check():
    try:
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({"success": False, "error": "No TTS provider configured"}), 500
        
        if hasattr(tts_provider, 'get_speakers'):
            speakers = tts_provider.get_speakers()
            return jsonify({
                "success": True,
                "provider": getattr(tts_provider, 'provider_name', 'unknown'),
                "speakers_count": len(speakers),
                "speakers": speakers[:5]
            })
        else:
            return jsonify({
                "success": True,
                "provider": getattr(tts_provider, 'provider_name', 'unknown')
            })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/test', methods=['POST'])
def tts_test():
    try:
        data = request.get_json()
        text = data.get('text', 'Hello, this is a test.')
        speaker = data.get('speaker', 'default')
        language = data.get('language', 'en')
        
        final_speaker, _ = resolve_speaker(data)
        
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500
        
        if hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(
                text=text,
                speaker=final_speaker,
                language=language
            )
            if result.get('success'):
                return jsonify({
                    "success": True, 
                    "audio": result.get('audio', ''), 
                    "sample_rate": result.get('sample_rate', 24000), 
                    "format": result.get('format', 'audio/wav'),
                    "text": text
                })
            else:
                return jsonify({"success": False, "error": result.get('error')}), 500
        else:
            return jsonify({"success": False, "error": "TTS provider does not support generate_audio method"}), 500
    except Exception as e: 
        return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/providers/status', methods=['GET'])
def providers_status():
    try:
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
        return jsonify({"success": False, "error": str(e)}), 500