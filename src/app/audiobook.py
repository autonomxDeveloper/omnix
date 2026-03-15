

import re
import json
import time
import requests
from flask import Blueprint, request, jsonify, Response
import app.shared as shared

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
    speech_verbs = r'(?:said|asked|replied|whispered|shouted|murmured|answered|added)'
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
                para_dialogues.append({'speaker': m.group(1).strip(), 'text': m.group(2).strip(), 'start': m.start()})
                last_speaker = m.group(1).strip()
                
        if not para_dialogues:
            for m in re.finditer(r'["\']([^"\']+)["\']\s*,?\s*(?:' + speech_verbs + r')\s+([A-Z][A-Za-z\'\-]+)', para, re.IGNORECASE):
                if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                    para_dialogues.append({'speaker': m.group(2).strip(), 'text': m.group(1).strip(), 'start': m.start()})
                    last_speaker = m.group(2).strip()
                    
        if not para_dialogues:
            for m in re.finditer(r'["\']([^"\']+)["\']', para):
                if m.group(1).strip() and not any(t in m.group(1) for t in thoughts):
                    para_dialogues.append({'speaker': last_speaker or 'Narrator', 'text': m.group(1).strip(), 'start': m.start()})
                    
        if para_dialogues:
            para_dialogues.sort(key=lambda x: x.get('start', 0))
            if para_dialogues[0]['start'] > 5:
                pre = re.sub(r'["\'].*?["\']', '', para[:para_dialogues[0]['start']]).strip()
                if pre: segments.append({'speaker': 'Narrator', 'text': pre})
            for d in para_dialogues: segments.append({'speaker': d['speaker'], 'text': d['text']})
        else:
            if '"' not in para and "'" not in para: segments.append({'speaker': 'Narrator', 'text': para})
            
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
    segments, v_map, def_v = data.get('segments', []), data.get('voice_mapping', {}), data.get('default_voices', {})
    avail = set(shared.custom_voices.keys())
    
    def gen():
        for i, seg in enumerate(segments):
            speaker, text = seg.get('speaker'), seg.get('text', '')
            if not text.strip(): continue
            
            v_name = v_map.get(speaker)
            if not v_name:
                g = detect_gender(speaker)
                v_name = def_v.get('female') if g == 'female' else def_v.get('male') if g == 'male' else def_v.get('narrator')
            
            vid = shared.custom_voices.get(v_name, {}).get('voice_clone_id') if v_name else None
            
            # Pass speaker name so audio.py can resolve it
            req = {"text": shared.remove_emojis(text), "language": "en", "speaker": v_name}
            if vid: req["voice_clone_id"] = vid
            
            try:
                r = requests.post(f"{shared.TTS_BASE_URL}/tts", json=req, timeout=60)
                if r.status_code == 200 and r.json().get('success'):
                    yield f"data: {json.dumps({'type': 'audio', 'audio': r.json().get('audio'), 'sample_rate': r.json().get('sample_rate'), 'segment_index': i, 'text': text[:100], 'voice_used': v_name})}\n\n"
            except Exception as e: yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
            time.sleep(0.1)
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    return Response(gen(), mimetype='text/event-stream')

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