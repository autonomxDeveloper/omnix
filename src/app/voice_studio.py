"""
Voice Studio Blueprint - Generate TTS audio with emotion controls.
Provides a POST /api/voice_studio/generate endpoint.
"""

import base64

from flask import Blueprint, request, jsonify

import app.shared as shared

voice_studio_bp = Blueprint("voice_studio", __name__)

EMOTION_MAP = {
    "neutral": {"speed": 1.0, "pitch": 0},
    "calm": {"speed": 0.9, "pitch": -1},
    "happy": {"speed": 1.1, "pitch": 2},
    "sad": {"speed": 0.85, "pitch": -2},
    "angry": {"speed": 1.2, "pitch": 1},
    "dramatic": {"speed": 0.95, "pitch": -1},
}

MAX_TEXT_LENGTH = 2000
SPEED_MIN = 0.7
SPEED_MAX = 1.5
PITCH_MIN = -5
PITCH_MAX = 5


@voice_studio_bp.route("/api/voice_studio/generate", methods=["POST"])
def generate_voice():
    data = request.json or {}

    text = data.get("text", "").strip()
    voice_id = data.get("voice_id")

    speed = float(data.get("speed", 1.0))
    pitch = float(data.get("pitch", 0))
    emotion = data.get("emotion", "neutral")

    # --- validation ---
    if not text:
        return jsonify({"success": False, "error": "Text is required"}), 400

    if len(text) > MAX_TEXT_LENGTH:
        return jsonify({"success": False, "error": f"Text must be {MAX_TEXT_LENGTH} characters or fewer"}), 400

    if not voice_id:
        return jsonify({"success": False, "error": "Voice is required"}), 400

    if not (SPEED_MIN <= speed <= SPEED_MAX):
        return jsonify({"success": False, "error": f"Speed must be between {SPEED_MIN} and {SPEED_MAX}"}), 400

    if not (PITCH_MIN <= pitch <= PITCH_MAX):
        return jsonify({"success": False, "error": f"Pitch must be between {PITCH_MIN} and {PITCH_MAX}"}), 400

    # Apply emotion fallback if user didn't tweak controls
    if emotion in EMOTION_MAP:
        emo = EMOTION_MAP[emotion]
        if speed == 1.0:
            speed = emo["speed"]
        if pitch == 0:
            pitch = emo["pitch"]

    try:
        # Resolve speaker from voice_id via shared custom_voices
        clean_speaker = voice_id.replace(" (Custom)", "").strip()
        voice_clone_id = shared.custom_voices.get(clean_speaker, {}).get("voice_clone_id")
        final_speaker = voice_clone_id if voice_clone_id else clean_speaker

        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            return jsonify({"success": False, "error": "No TTS provider available"}), 500

        # Generate audio via the existing TTS provider
        gen_kwargs = {"text": text, "speaker": final_speaker, "language": "en"}

        if hasattr(tts_provider, "generate_tts"):
            result = tts_provider.generate_tts(**gen_kwargs)
        elif hasattr(tts_provider, "generate_audio"):
            result = tts_provider.generate_audio(**gen_kwargs)
        else:
            return jsonify({"success": False, "error": "TTS provider missing generation method"}), 500

        if not result or not result.get("success"):
            return jsonify({"success": False, "error": result.get("error", "TTS generation failed") if result else "TTS generation failed"}), 500

        audio_b64 = result.get("audio", "")

        return jsonify({
            "success": True,
            "audio_base64": audio_b64,
        })

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@voice_studio_bp.route("/api/voice_studio/voices", methods=["GET"])
def list_voices():
    """Return available voices for the Voice Studio dropdown."""
    voices = []

    # Pull from shared custom_voices
    for vid, vdata in shared.custom_voices.items():
        voices.append({
            "id": vid,
            "name": vid,
            "gender": vdata.get("gender", "neutral"),
        })

    # Also try to include TTS provider built-in speakers
    tts_provider = shared.get_tts_provider()
    if tts_provider:
        try:
            if hasattr(tts_provider, "get_speakers"):
                for s in tts_provider.get_speakers():
                    sid = s.get("id", s.get("name", ""))
                    if sid and not any(v["id"] == sid for v in voices):
                        voices.append({"id": sid, "name": s.get("name", sid), "gender": "neutral"})
            elif hasattr(tts_provider, "get_voices"):
                for s in tts_provider.get_voices():
                    sid = s.get("id", s.get("name", ""))
                    if sid and not any(v["id"] == sid for v in voices):
                        voices.append({"id": sid, "name": s.get("name", sid), "gender": "neutral"})
        except Exception:
            pass

    # Ensure at least one default voice is available
    if not voices:
        voices.append({"id": "default", "name": "Default", "gender": "neutral"})

    return jsonify({"success": True, "voices": voices})
