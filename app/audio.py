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
        try: requests.delete(f"{shared.TTS_BASE_URL}/voice_clone/{voice_id}", timeout=10)
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
            r = requests.post(f"{shared.TTS_BASE_URL}/voice_clone", files={'file': (a_file.filename, a_file.stream, a_file.content_type)}, data={'voice_id': v_name, 'ref_text': request.form.get('ref_text', '')}, timeout=60)
            if r.status_code == 200 and r.json().get('success'): has_audio = True
        except: pass
        
    shared.custom_voices[v_name] = {"speaker": "default", "language": request.form.get('language', 'en'), "voice_clone_id": v_name, "has_audio": has_audio}
    with open(shared.VOICE_CLONES_FILE, 'w') as f: json.dump(shared.custom_voices, f, indent=2)
    return jsonify({"success": True, "voice_id": v_name})

@audio_bp.route('/api/tts', methods=['POST'])
def tts():
    data = request.get_json()
    text = shared.remove_emojis(data.get('text', ''))
    if not text: return jsonify({"success": False, "error": "Text required"}), 400
    
    vid = shared.custom_voices.get(data.get('speaker', 'default').replace(" (Custom)", ""), {}).get("voice_clone_id")
    req_data = {"text": text, "language": "en"}
    if vid: req_data["voice_clone_id"] = vid
    
    try:
        r = requests.post(f"{shared.TTS_BASE_URL}/tts", json=req_data, timeout=60)
        if r.status_code == 200 and r.json().get('success'):
            res = r.json()
            audio_arr = np.frombuffer(base64.b64decode(res.get('audio', '')), dtype=np.int16)
            wav_io = io.BytesIO()
            with wave.open(wav_io, 'wb') as wf:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(res.get('sample_rate', shared.TTS_SAMPLE_RATE))
                wf.writeframes(audio_arr.tobytes())
            return jsonify({"success": True, "audio": base64.b64encode(wav_io.getvalue()).decode('utf-8'), "sample_rate": res.get('sample_rate', shared.TTS_SAMPLE_RATE), "format": "audio/wav"})
        return jsonify({"success": False, "error": "TTS Error"}), 500
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@audio_bp.route('/api/tts/speakers', methods=['GET'])
def get_speakers():
    speakers, seen = [], set()
    try:
        for v in requests.get(f"{shared.TTS_BASE_URL}/voices", timeout=5).json().get('voices', []):
            seen.add(v); speakers.append({"id": v, "name": v, "language": "en", "source": "chatterbox"})
    except: pass
    for k, v in shared.custom_voices.items():
        if k not in seen:
            seen.add(k); speakers.append({"id": k, "name": k, "language": v.get("language", "en"), "is_custom": v.get("is_preloaded", False)})
    return jsonify({"success": True, "speakers": speakers})

@audio_bp.route('/api/stt', methods=['POST'])
def stt():
    if 'audio' not in request.files: return jsonify({"success": False, "error": "No audio file"}), 400
    a_file = request.files['audio']
    a_data = a_file.read()
    if len(a_data) < 100: return jsonify({"success": False, "error": "Audio too small"}), 400
    
    try:
        r = requests.post(f"{shared.STT_BASE_URL}/transcribe", files={'file': (a_file.filename, a_data, a_file.content_type)}, timeout=120)
        if r.status_code == 200 and r.json().get('success'):
            text = ' '.join([s['text'] for s in r.json().get('segments', [])])
            if not text.strip(): return jsonify({"success": False, "error": "No speech detected"}), 400
            return jsonify({"success": True, "text": text, "segments": r.json().get('segments', []), "duration": r.json().get('duration')})
        return jsonify({"success": False, "error": "STT Error"}), 500
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

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
            
        r = requests.post(f"{shared.STT_BASE_URL}/transcribe", files={'file': ('audio.wav', wav_io.getvalue(), 'audio/wav')}, timeout=120)
        if r.status_code == 200 and r.json().get('success'):
            text = ' '.join([s['text'] for s in r.json().get('segments', [])])
            return jsonify({"success": True, "text": text, "segments": r.json().get('segments', [])})
        return jsonify({"success": False}), 500
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500