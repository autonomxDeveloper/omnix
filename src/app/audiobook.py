

import os
import re
import sys
import json
import time
import requests
from flask import Blueprint, request, jsonify, Response, send_file
import app.shared as shared

# Make the src/audiobook package importable from within src/app/
_SRC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SRC_DIR not in sys.path:
    sys.path.insert(0, _SRC_DIR)

audiobook_bp = Blueprint('audiobook', __name__)

FEMALE_NAMES = {'sofia', 'emma', 'olivia', 'ava', 'mia', 'charlotte', 'amelia', 'harper', 'evelyn', 'sarah', 'laura', 'kate', 'jessica', 'ciri', 'her', 'anaka'}
MALE_NAMES = {'morgan', 'james', 'john', 'robert', 'michael', 'david', 'richard', 'joseph', 'thomas', 'charles', 'nate', 'inigo', 'jinx'}

def detect_gender(name):
    if not name: return 'neutral'
    nl = name.lower().strip()
    if any(w in nl for w in ['ms.', 'mrs.', 'she', 'her', 'woman']): return 'female'
    if any(w in nl for w in ['mr.', 'he', 'him', 'man']): return 'male'
    if any(f in nl for f in FEMALE_NAMES): return 'female'
    if any(m in nl for m in MALE_NAMES): return 'male'
    return 'neutral'

def parse_dialogue(text):
    segments = []
    speech_verbs = r'(?:said|asked|replied|whispered|shouted|murmured|answered|added|insisted|demanded|muttered|sighed|groaned|exclaimed|called|declared|continued|suggested|offered|responded)'
    thought_pattern = re.compile(r'([A-Z][A-Za-z\'\-]+)\s+(?:thought|wondered)\s*[,:]*\s*["\']([^"\']+)["\']', re.IGNORECASE)
    
    paragraphs = re.split(r'\n\s*\n', text)
    if len(paragraphs) <= 2 and '\n' in text: paragraphs = [p for p in text.split('\n') if p.strip()]
    
    last_speaker = None
    for para in paragraphs:
        para = para.strip()
        if not para: continue
        
        para_dialogues = []
        thoughts = [t[1] for t in thought_pattern.findall(para)]
        
        for m in re.finditer(r'([A-Z][A-Za-z\'\-]+)\s*:\s*(.+)$', para, re.MULTILINE):
            if m.group(2).strip() and not any(t in m.group(2) for t in thoughts):
                para_dialogues.append({'speaker': m.group(1).strip(), 'text': m.group(2).strip(), 'start': m.start(), 'end': m.end()})
                last_speaker = m.group(1).strip()
                
        if not para_dialogues:
            matched_spans = []
            # Pattern: "dialogue," verb Speaker  (e.g. "Heartless," said Tom)
            for m in re.finditer(r'["\u201c]([^"\u201d]+)["\u201d]\s*,?\s*(?:' + speech_verbs + r')\s+([A-Z][A-Za-z\'\-]+)', para, re.IGNORECASE):
                if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                    para_dialogues.append({'speaker': m.group(2).strip(), 'text': m.group(1).strip(), 'start': m.start(), 'end': m.end()})
                    last_speaker = m.group(2).strip()
                    matched_spans.append((m.start(), m.end()))

            # Pattern: "dialogue," Speaker verb  (e.g. "I'm serious," Maya insisted)
            for m in re.finditer(r'["\u201c]([^"\u201d]+)["\u201d]\s*,?\s*([A-Z][A-Za-z\'\-]+)\s+(?:' + speech_verbs + r')', para, re.IGNORECASE):
                if any(s <= m.start() < e for s, e in matched_spans):
                    continue
                if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                    para_dialogues.append({'speaker': m.group(2).strip(), 'text': m.group(1).strip(), 'start': m.start(), 'end': m.end()})
                    last_speaker = m.group(2).strip()
                    matched_spans.append((m.start(), m.end()))

            # Also find remaining quoted segments not captured by speech-verb patterns
            if para_dialogues:
                for m in re.finditer(r'["\u201c]([^"\u201d]+)["\u201d]', para):
                    if any(s <= m.start() < e for s, e in matched_spans):
                        continue
                    if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                        para_dialogues.append({'speaker': last_speaker or 'Narrator', 'text': m.group(1).strip(), 'start': m.start(), 'end': m.end()})
                    
        if not para_dialogues:
            for m in re.finditer(r'["\u201c]([^"\u201d]+)["\u201d]', para):
                if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                    para_dialogues.append({'speaker': last_speaker or 'Narrator', 'text': m.group(1).strip(), 'start': m.start(), 'end': m.end()})
                    
        if para_dialogues:
            para_dialogues.sort(key=lambda x: x.get('start', 0))

            # Collect matched spans for gap extraction
            spans = [(d['start'], d.get('end', d['start'] + len(d['text']) + 2)) for d in para_dialogues]

            # Narration before first dialogue
            if spans[0][0] > 0:
                pre = re.sub(r'["\u201c].*?["\u201d]', '', para[:spans[0][0]]).strip()
                if pre: segments.append({'speaker': 'Narrator', 'text': pre})

            for i, d in enumerate(para_dialogues):
                segments.append({'speaker': d['speaker'], 'text': d['text']})
                # Narration gap between this dialogue and the next
                if i < len(para_dialogues) - 1:
                    gap_text = para[spans[i][1]:spans[i + 1][0]]
                    gap_text = re.sub(r'["\u201c].*?["\u201d]', '', gap_text).strip('.,;: \t\n')
                    if gap_text:
                        segments.append({'speaker': 'Narrator', 'text': gap_text})

            # Narration after last dialogue
            if spans[-1][1] < len(para):
                post = re.sub(r'["\u201c].*?["\u201d]', '', para[spans[-1][1]:]).strip('.,;: \t\n')
                if post:
                    segments.append({'speaker': 'Narrator', 'text': post})
        else:
            if '"' not in para and '\u201c' not in para: segments.append({'speaker': 'Narrator', 'text': para})

    # Resolve any remaining "unknown" or empty speakers
    for seg in segments:
        sp = seg.get("speaker", "")
        if not sp or sp.lower() == "unknown":
            seg["speaker"] = last_speaker or "Narrator"

    return segments

@audiobook_bp.route('/api/audiobook/upload', methods=['POST'])
def upload():
    text = None
    if 'file' in request.files:
        f = request.files['file']
        if f.filename.endswith('.pdf'):
            import PyPDF2
            text = "".join(p.extract_text() + "\n" for p in PyPDF2.PdfReader(f).pages)
        elif f.filename.endswith('.txt'): text = f.read().decode('utf-8')
    elif request.form.get('text'): text = request.form.get('text')
    elif request.is_json: text = request.get_json().get('text', '')
    
    if not text: return jsonify({"success": False, "error": "No text"}), 400
    segs = parse_dialogue(text)
    return jsonify({"success": True, "segments": segs, "speakers": list(set(s['speaker'] for s in segs))})

@audiobook_bp.route('/api/audiobook/generate', methods=['POST'])
def generate():
    data = request.get_json()
    segments = data.get('segments', [])
    v_map = data.get('voice_mapping', {})
    # voice_map is the canonical single-source-of-truth from the UI
    voice_map = data.get('voice_map', {})
    # Merge: voice_map takes precedence over voice_mapping
    merged_map = {**v_map, **voice_map}
    def_v = data.get('default_voices', {})
    avail = set(shared.custom_voices.keys())
    job_id = data.get('job_id', f"job_{int(time.time())}")

    def estimate_duration(text: str) -> float:
        """Estimate speech duration at ~150 WPM."""
        words = len(text.split())
        return max(0.4, words / 2.5)

    def gen():
        # Use the configured TTS provider (same as /api/tts endpoint)
        tts_provider = shared.get_tts_provider()
        if not tts_provider:
            yield f"data: {json.dumps({'type': 'error', 'error': 'No TTS provider available. Please check your TTS settings.', 'code': 'TTS_UNAVAILABLE'})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return

        # Dump segments for debugging
        try:
            with open(f"/tmp/audiobook_segments_{job_id}.json", "w") as _fh:
                json.dump(segments, _fh, indent=2)
        except Exception:
            pass

        current_time = 0.0

        for i, seg in enumerate(segments):
            speaker, text = seg.get('speaker'), seg.get('text', '')
            if not text.strip(): continue

            v_name = merged_map.get(speaker)
            if not v_name:
                g = detect_gender(speaker)
                v_name = def_v.get('female') if g == 'female' else def_v.get('male') if g == 'male' else def_v.get('narrator')

            vid = shared.custom_voices.get(v_name, {}).get('voice_clone_id') if v_name else None

            final_speaker = vid if vid else v_name

            try:
                if hasattr(tts_provider, 'generate_tts'):
                    result = tts_provider.generate_tts(text=shared.remove_emojis(text), speaker=final_speaker, language="en")
                elif hasattr(tts_provider, 'generate_audio'):
                    result = tts_provider.generate_audio(text=shared.remove_emojis(text), speaker=final_speaker, language="en")
                else:
                    yield f"data: {json.dumps({'type': 'error', 'error': 'TTS provider missing generate method.'})}\n\n"
                    break

                if result and result.get('success'):
                    duration = estimate_duration(text)
                    payload = {
                        'type': 'audio',
                        'audio': result.get('audio', ''),
                        'sample_rate': result.get('sample_rate', 24000),
                        'segment_index': i,
                        'text': text[:100],
                        'voice_used': v_name,
                        'start_time': current_time,
                        'end_time': current_time + duration,
                        'duration': duration,
                    }
                    yield f"data: {json.dumps(payload)}\n\n"
                    current_time += duration
                else:
                    yield f"data: {json.dumps({'type': 'error', 'error': result.get('error', 'TTS generation failed')})}\n\n"
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
                yield f"data: {json.dumps({'type': 'error', 'error': 'TTS server is not running. Please start the TTS server and try again.', 'code': 'TTS_UNAVAILABLE'})}\n\n"
                break
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
            time.sleep(0.1)
        yield f"data: {json.dumps({'type': 'done', 'job_id': job_id})}\n\n"
    return Response(gen(), mimetype='text/event-stream')


@audiobook_bp.route('/api/audiobook/<job_id>/download', methods=['GET'])
def download_audiobook(job_id: str):
    """Download the accumulated WAV file for a completed audiobook job."""
    # Sanitize job_id: allow alphanumeric, underscore, hyphen only
    if not re.match(r'^[A-Za-z0-9_\-]+$', job_id):
        return jsonify({"error": "Invalid job_id"}), 400
    path = f"/tmp/audiobook_{job_id}.wav"
    if not os.path.exists(path):
        return jsonify({"error": "Audio file not found"}), 404
    return send_file(path, mimetype='audio/wav', as_attachment=True,
                     download_name='audiobook.wav')

@audiobook_bp.route('/api/audiobook/speakers/detect', methods=['POST'])
def detect():
    segs = parse_dialogue(request.get_json().get('text', ''))
    speakers = {}
    for s in segs:
        sp = s.get('speaker')
        if sp and sp not in speakers: speakers[sp] = {'name': sp, 'gender': detect_gender(sp), 'segment_count': 1}
        elif sp: speakers[sp]['segment_count'] += 1
        
    avail = list(shared.custom_voices.keys())
    for sp, info in speakers.items():
        match = next((v for v in avail if sp.lower() in v.lower() or v.lower() in sp.lower()), None)
        if match: info['suggested_voice'] = match
        else: info['suggested_voice'] = next((v for v in avail if info['gender'] in v.lower()), avail[0] if avail else None)
        
    return jsonify({"success": True, "speakers": speakers, "available_voices": avail})


# ---------------------------------------------------------------------------
# Shared LLM helper (same pattern as podcast.py)
# ---------------------------------------------------------------------------

def _llm_generate(prompt: str) -> str:
    """Call the configured LLM and return its text response."""
    cfg = shared.get_provider_config()
    payload = {
        "model": cfg.get("model", "local-model"),
        "messages": [{"role": "user", "content": prompt}],
    }
    headers = {"Content-Type": "application/json"}
    if cfg["provider"] in ("openrouter", "cerebras"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    url = (
        f"{cfg['base_url']}/chat/completions"
        if cfg["provider"] == "openrouter"
        else f"{cfg['base_url']}/v1/chat/completions"
    )
    r = requests.post(url, json=payload, headers=headers, timeout=120)
    if r.status_code == 200:
        return r.json()["choices"][0]["message"]["content"]
    return ""


# ---------------------------------------------------------------------------
# AI Structuring endpoint
# ---------------------------------------------------------------------------

@audiobook_bp.route('/api/audiobook/ai-structure', methods=['POST'])
def ai_structure():
    """Structure raw text into a directed audiobook script using the LLM."""
    data = request.get_json() or {}
    text = data.get("text", "")
    title = data.get("title", "")
    book_id = data.get("book_id", "default")

    if not text.strip():
        return jsonify({"success": False, "error": "No text provided"}), 400

    try:
        from audiobook.ai.ai_structuring_service import AIStructuringService
        from audiobook.voice.character_normalizer import CharacterNormalizer
        from audiobook.voice.character_voice_memory import CharacterVoiceMemory
        from audiobook.voice.voice_assignment import VoiceAssignment

        normalizer = CharacterNormalizer()
        memory = CharacterVoiceMemory(
            book_id,
            base_dir=os.path.join(shared.DATA_DIR, "audiobooks"),
        )
        avail_voices = list(shared.custom_voices.keys())

        service = AIStructuringService(llm_fn=_llm_generate)
        structured = service.structure(text, title=title)

        # Normalize speaker names and attach persistent voices
        assignment = VoiceAssignment(
            available_voices=avail_voices,
            memory=memory,
            normalizer=normalizer,
        )
        for seg in structured.get("segments", []):
            for line in seg.get("script", []):
                line["speaker"] = normalizer.normalize(line.get("speaker", ""))
                line["voice"] = assignment.get_voice(line["speaker"])

        # Update character list after normalization
        all_speakers = list({
            line["speaker"]
            for seg in structured.get("segments", [])
            for line in seg.get("script", [])
        })
        structured["characters"] = [
            {"id": re.sub(r'\W+', '_', s.lower()), "name": s}
            for s in all_speakers
        ]

        return jsonify({"success": True, "structured_script": structured})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------------------------------------------------------------------------
# AI Direction endpoint
# ---------------------------------------------------------------------------

@audiobook_bp.route('/api/audiobook/direct', methods=['POST'])
def direct():
    """Apply AI narration direction (pacing, emotion, emphasis) to a script."""
    data = request.get_json() or {}
    script = data.get("script", [])
    book_id = data.get("book_id", "default")

    if not script:
        return jsonify({"success": False, "error": "No script provided"}), 400

    try:
        from audiobook.director.audiobook_director import AudiobookDirector
        from audiobook.voice.character_normalizer import CharacterNormalizer
        from audiobook.voice.character_voice_memory import CharacterVoiceMemory
        from audiobook.voice.voice_assignment import VoiceAssignment

        normalizer = CharacterNormalizer()
        memory = CharacterVoiceMemory(
            book_id,
            base_dir=os.path.join(shared.DATA_DIR, "audiobooks"),
        )
        avail_voices = list(shared.custom_voices.keys())
        assignment = VoiceAssignment(
            available_voices=avail_voices,
            memory=memory,
            normalizer=normalizer,
        )

        director = AudiobookDirector(llm_fn=_llm_generate)

        # Normalise speaker names before directing
        normalised_script = [
            {**line, "speaker": normalizer.normalize(line.get("speaker", ""))}
            for line in script
        ]

        directed = director.direct(normalised_script)

        # Attach voices
        for line in directed:
            line["voice"] = assignment.get_voice(line["speaker"])

        return jsonify({"success": True, "directed_script": directed})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ---------------------------------------------------------------------------
# Voice profile CRUD endpoints
# ---------------------------------------------------------------------------

@audiobook_bp.route('/api/audiobook/books/<book_id>/voices', methods=['GET'])
def get_voice_profiles(book_id: str):
    """Return all stored voice profiles for a book."""
    try:
        from audiobook.voice.character_voice_memory import CharacterVoiceMemory
        memory = CharacterVoiceMemory(
            book_id,
            base_dir=os.path.join(shared.DATA_DIR, "audiobooks"),
        )
        return jsonify({
            "success": True,
            "book_id": book_id,
            "voices": memory.all_profiles(),
            "available_voices": list(shared.custom_voices.keys()),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@audiobook_bp.route('/api/audiobook/books/<book_id>/voices', methods=['PUT'])
def update_voice_profiles(book_id: str):
    """Bulk-update voice profiles for a book (used by the Voice Panel UI)."""
    data = request.get_json() or {}
    voices = data.get("voices", {})

    if not isinstance(voices, dict):
        return jsonify({"success": False, "error": "voices must be an object"}), 400

    try:
        from audiobook.voice.character_voice_memory import CharacterVoiceMemory
        memory = CharacterVoiceMemory(
            book_id,
            base_dir=os.path.join(shared.DATA_DIR, "audiobooks"),
        )
        for character, profile in voices.items():
            if isinstance(profile, str):
                # Allow shorthand: {"Alice": "young_female"}
                memory.set_voice(character, profile)
            elif isinstance(profile, dict):
                memory.update_profile(character, profile)
        return jsonify({"success": True, "voices": memory.all_profiles()})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500