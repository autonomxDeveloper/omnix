#!/usr/bin/env python3
"""
FastAPI Server for Ultra-Low-Latency Voice Conversation
Replaces Flask for streaming endpoints to achieve sub-500ms latency

Key optimizations:
- WebSocket instead of HTTP SSE
- Binary PCM instead of base64
- Predictive TTS (start after 25 chars)
- Pre-loaded TTS model
"""

import asyncio
import base64
import json
import queue
import requests
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import existing infrastructure
import sys
sys.path.insert(0, str(Path(__file__).parent))

import app.shared as shared
from app.providers.base import ChatMessage


# ============== CONFIG ==============
HOST = "0.0.0.0"
PORT = 5000
TTS_CHUNK_SIZE = 6  # ~0.5s (12000 samples at 24kHz) for stable streaming
TTS_MIN_CHARS = 25  # Start TTS after this many chars
TTS_MAX_CHARS = 80  # Max chars per TTS chunk
LLM_MAX_TOKENS = 60  # Max tokens before forcing TTS


# ============== GLOBAL STATE ==============
@dataclass
class ConversationSession:
    """State for each conversation session"""
    websocket: WebSocket
    session_id: str
    speaker: str = "default"
    buffer: str = ""
    tts_queue: queue.Queue = field(default_factory=queue.Queue)
    last_tts_time: float = 0
    stop_requested: bool = False


# Global session management
sessions: Dict[str, ConversationSession] = {}
sessions_lock = threading.Lock()

# TTS worker
tts_worker_thread: Optional[threading.Thread] = None
tts_provider = None
llm_provider = None
executor = ThreadPoolExecutor(max_workers=2)


# ============== APP LIFECYCLE ==============
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize providers on startup"""
    global tts_provider, llm_provider
    
    print("[FASTAPI] Starting up...")
    
    # Initialize TTS provider
    try:
        tts_provider = shared.get_tts_provider()
        if tts_provider:
            print(f"[FASTAPI] TTS provider loaded: {tts_provider.provider_name}")
            # Warm up the model
            _warmup_tts()
        else:
            print("[FASTAPI] WARNING: No TTS provider available")
    except Exception as e:
        print(f"[FASTAPI] ERROR loading TTS: {e}")
    
    # Initialize LLM provider
    try:
        llm_provider = shared.get_provider()
        if llm_provider:
            print(f"[FASTAPI] LLM provider loaded: {llm_provider.config.model}")
        else:
            print("[FASTAPI] WARNING: No LLM provider available")
    except Exception as e:
        print(f"[FASTAPI] ERROR loading LLM: {e}")
    
    # Start TTS worker thread
    start_tts_worker()
    
    yield
    
    print("[FASTAPI] Shutting down...")


def _warmup_tts():
    """Warm up TTS model with a test generation"""
    if not tts_provider:
        return
    
    try:
        print("[FASTAPI] Warming up TTS...")
        # Try to get a reference audio path
        ref_audio_path = None
        voice_clones_dir = Path(__file__).parent / 'voice_clones'
        if voice_clones_dir.exists():
            wav_files = list(voice_clones_dir.glob('*.wav'))
            if wav_files:
                ref_audio_path = str(wav_files[0])
        
        # If no voice clone, try to generate without reference (will use default voice)
        if hasattr(tts_provider, 'generate_audio_stream'):
            try:
                # Warmup with streaming - may fail if no ref audio
                for _ in tts_provider.generate_audio_stream(
                    text="hello",
                    speaker="default",
                    language="English",
                    chunk_size=TTS_CHUNK_SIZE,
                    non_streaming_mode=False,
                    temperature=0.6,
                    top_k=20,
                    append_silence=False,
                    max_new_tokens=30
                ):
                    break
            except Exception as warmup_err:
                print(f"[FASTAPI] TTS warmup stream error (may be OK): {warmup_err}")
                
        print("[FASTAPI] TTS warmup complete!")
    except Exception as e:
        print(f"[FASTAPI] TTS warmup error: {e}")


def start_tts_worker():
    """Start background worker for TTS generation"""
    global tts_worker_thread
    
    def worker():
        """Background thread that processes TTS requests"""
        while True:
            try:
                # Get next request from any session
                with sessions_lock:
                    active_sessions = [s for s in sessions.values() if not s.stop_requested]
                
                if not active_sessions:
                    time.sleep(0.01)
                    continue
                
                # Check each session's queue
                for session in active_sessions:
                    try:
                        text = session.tts_queue.get_nowait()
                        if text and len(text.strip()) >= 3:
                            _generate_tts_stream(session, text.strip())
                    except queue.Empty:
                        continue
                    except Exception as e:
                        print(f"[TTS WORKER] Error: {e}")
                        
            except Exception as e:
                print(f"[TTS WORKER] Fatal error: {e}")
                time.sleep(0.1)
    
    tts_worker_thread = threading.Thread(target=worker, daemon=True)
    tts_worker_thread.start()
    print("[FASTAPI] TTS worker started")


def _generate_tts_stream(session: ConversationSession, text: str):
    """Generate TTS and send directly via WebSocket"""
    if not tts_provider or session.stop_requested:
        return
    
    try:
        start_time = time.time()
        
        if hasattr(tts_provider, 'generate_audio_stream'):
            first_sent = False
            
            for audio_chunk, sr, timing in tts_provider.generate_audio_stream(
                text=text,
                speaker=session.speaker,
                language="English",
                chunk_size=TTS_CHUNK_SIZE,
                non_streaming_mode=False,
                temperature=0.6,
                top_k=20,
                top_p=0.85,
                repetition_penalty=1.0,
                append_silence=False,
                max_new_tokens=180
            ):
                if session.stop_requested:
                    break
                    
                if audio_chunk is not None and len(audio_chunk) > 0:
                    pcm_float32 = audio_chunk.astype(np.float32).tobytes()
                    
                    try:
                        asyncio.run(session.websocket.send_bytes(pcm_float32))
                        
                        if not first_sent:
                            elapsed = (time.time() - start_time) * 1000
                            print(f"[TTS] First chunk for '{text[:20]}...' in {elapsed:.0f}ms")
                            first_sent = True
                    except Exception as e:
                        print(f"[TTS] Send error: {e}")
                        break
                        
    except Exception as e:
        print(f"[TTS] Generation error: {e}")


# ============== FASTAPI APP ==============
app = FastAPI(title="Omnix FastAPI", lifespan=lifespan)

# Serve static files directly
from fastapi.responses import FileResponse, HTMLResponse, Response
from pathlib import Path

BASE_DIR = Path(__file__).parent
static_dir = BASE_DIR / 'static'
templates_dir = BASE_DIR / 'templates'
index_file = templates_dir / 'index.html'

# Cache for processed index.html
_index_html_cache = None

def get_index_html():
    """Get index.html with Flask url_for replaced"""
    global _index_html_cache
    if _index_html_cache is not None:
        return _index_html_cache
    
    if index_file.exists():
        content = index_file.read_text(encoding='utf-8')
        # Replace Flask url_for with static paths
        content = content.replace("{{ url_for('static', filename='", '/static/')
        content = content.replace("') }}", '')
        # Also handle variable replacements
        content = content.replace("{{ ", "").replace(" }}", "")
        _index_html_cache = content
        return content
    return None

@app.get("/")
async def root():
    """Serve the main HTML page"""
    content = get_index_html()
    if content:
        return HTMLResponse(content)
    return HTMLResponse("<h1>Omnix</h1><p>Static files not found</p>")

@app.get("/static/{path:path}")
async def serve_static(path: str):
    """Serve static files"""
    file_path = static_dir / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return HTMLResponse("Not Found", status_code=404)

@app.get("/logo/{path:path}")
async def serve_logo(path: str):
    """Serve logo files"""
    logo_dir = Path(shared.BASE_DIR) / 'logo'
    file_path = logo_dir / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return HTMLResponse("Not Found", status_code=404)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "server": "fastapi"}


# ============== WEBSOCKET ENDPOINT ==============
@app.websocket("/ws/conversation")
async def websocket_conversation(websocket: WebSocket):
    """Main WebSocket endpoint for voice conversation"""
    await websocket.accept()
    
    session_id = None
    session = None
    
    try:
        # Wait for initial config message
        config_data = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
        session_id = config_data.get("session_id", "default")
        speaker = config_data.get("speaker", "default")
        
        print(f"[WS] New session: {session_id}, speaker: {speaker}")
        
        # Create session
        with sessions_lock:
            session = ConversationSession(
                websocket=websocket,
                session_id=session_id,
                speaker=speaker
            )
            sessions[session_id] = session
        
        # Send ready signal
        await websocket.send_json({"type": "ready"})
        
        # Main message loop
        while not session.stop_requested:
            try:
                # Wait for user input with timeout
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                
                msg_type = message.get("type")
                
                if msg_type == "stop":
                    session.stop_requested = True
                    await websocket.send_json({"type": "stopped"})
                    break
                    
                elif msg_type == "text":
                    user_text = message.get("text", "")
                    await _process_conversation(session, user_text)
                    
                elif msg_type == "config":
                    # Update config
                    if "speaker" in message:
                        session.speaker = message["speaker"]
                    
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"[WS] Error: {e}")
                try:
                    await websocket.send_json({"type": "error", "error": str(e)})
                except:
                    break
                
    except Exception as e:
        print(f"[WS] Connection error: {e}")
        
    finally:
        # Cleanup
        if session_id and session_id in sessions:
            with sessions_lock:
                del sessions[session_id]
        print(f"[WS] Session ended: {session_id}")


async def _process_conversation(session: ConversationSession, user_text: str):
    """Process conversation and stream response"""
    if not llm_provider:
        await session.websocket.send_json({"type": "error", "error": "No LLM provider"})
        return
    
    try:
        # Get conversation history
        messages = []
        if session.session_id in shared.sessions_data:
            raw_messages = shared.sessions_data[session.session_id].get('messages', [])
            for msg in raw_messages:
                if isinstance(msg, dict):
                    messages.append(ChatMessage(role=msg.get('role', 'user'), content=msg.get('content', '')))
                elif hasattr(msg, 'role') and hasattr(msg, 'content'):
                    messages.append(msg)
        
        # Add user message
        messages.append(ChatMessage(role="user", content=user_text))
        
        # Prepare for streaming
        buffer = ""
        sentence_buffer = ""
        
        start_time = time.time()
        
        # Stream from LLM
        stream_generator = llm_provider.chat_completion(
            messages=messages,
            model=llm_provider.config.model,
            stream=True
        )
        
        first_token_time = None
        
        for response_chunk in stream_generator:
            if session.stop_requested:
                break
                
            content = response_chunk.content if hasattr(response_chunk, 'content') else str(response_chunk)
            
            if content:
                if first_token_time is None:
                    first_token_time = time.time()
                    elapsed = (first_token_time - start_time) * 1000
                    print(f"[LLM] First token: {elapsed:.0f}ms")
                    await session.websocket.send_json({
                        "type": "token",
                        "time": elapsed
                    })
                
                buffer += content
                sentence_buffer += content
                
                # Send token to client for display
                await session.websocket.send_json({
                    "type": "content",
                    "content": content
                })
                
                # PREDICTIVE TTS: Send to worker after minimum chars
                if len(sentence_buffer) >= TTS_MIN_CHARS:
                    # Check for sentence end or punctuation
                    should_send = False
                    for punct in '.!?,':
                        if punct in sentence_buffer:
                            should_send = True
                            break
                    
                    if should_send or len(sentence_buffer) >= TTS_MAX_CHARS:
                        # Send this chunk to TTS worker
                        text_to_speak = sentence_buffer.strip()
                        if text_to_speak:
                            # Send text to TTS queue
                            try:
                                session.tts_queue.put_nowait(text_to_speak)
                            except:
                                pass
                        
                        # Keep any remaining text
                        # Find the last punctuation
                        last_punct = -1
                        for i, c in enumerate(sentence_buffer):
                            if c in '.!?,':
                                last_punct = i
                        
                        if last_punct >= 0 and last_punct < len(sentence_buffer) - 1:
                            sentence_buffer = sentence_buffer[last_punct + 1:]
                        else:
                            sentence_buffer = ""
        
        # Process remaining buffer
        if sentence_buffer.strip() and not session.stop_requested:
            try:
                session.tts_queue.put_nowait(sentence_buffer.strip())
            except:
                pass
        
        # Send done signal
        await session.websocket.send_json({
            "type": "done",
            "total_time": (time.time() - start_time) * 1000
        })
        
        # Save to history
        if session.session_id in shared.sessions_data:
            shared.sessions_data[session.session_id]['messages'].append({
                "role": "assistant", 
                "content": buffer
            })
            shared.save_sessions(shared.sessions_data)
            
    except Exception as e:
        print(f"[CONV] Error: {e}")
        try:
            await session.websocket.send_json({
                "type": "error", 
                "error": str(e)
            })
        except:
            pass


# ============== REST API ENDPOINTS ==============
import uuid
from datetime import datetime
from fastapi import Request, HTTPException


@app.get("/api/settings")
async def get_settings():
    """Get settings"""
    settings = shared.load_settings()
    for key in ['openrouter', 'cerebras']:
        if settings.get(key, {}).get('api_key'):
            settings[key]['api_key'] = "***" + settings[key]['api_key'][-4:] if len(settings[key]['api_key']) > 4 else "****"
    return {"success": True, "settings": settings}


@app.post("/api/settings")
async def save_settings(request: Request):
    """Save settings"""
    data = await request.json()
    settings = shared.load_settings()
    
    if 'provider' in data:
        settings['provider'] = data['provider']
    if 'global_system_prompt' in data:
        settings['global_system_prompt'] = data['global_system_prompt']
    if 'lmstudio' in data:
        settings['lmstudio'].update(data['lmstudio'])
    
    for key in ['openrouter', 'cerebras']:
        if key in data:
            if key not in settings:
                settings[key] = {}
            if data[key].get('api_key') and not data[key]['api_key'].startswith('***'):
                settings[key]['api_key'] = data[key]['api_key']
            settings[key].update({k: v for k, v in data[key].items() if k != 'api_key'})
            
    if 'llamacpp' in data:
        if 'llamacpp' not in settings:
            settings['llamacpp'] = shared.DEFAULT_SETTINGS['llamacpp'].copy()
        settings['llamacpp'].update(data['llamacpp'])
        
    shared.save_settings(settings)
    return {"success": True}


@app.get("/api/sessions")
async def get_sessions():
    """Get all sessions"""
    shared.sessions_data = shared.load_sessions()
    sl = sorted(
        [{'id': k, 'title': v.get('title', 'New Chat'), 'updated_at': v.get('updated_at', '')} 
         for k, v in shared.sessions_data.items()],
        key=lambda x: x['updated_at'],
        reverse=True
    )
    return {"success": True, "sessions": sl}


@app.post("/api/sessions")
async def create_session():
    """Create new session"""
    shared.sessions_data = shared.load_sessions()
    sid = str(uuid.uuid4())[:8]
    shared.sessions_data[sid] = {
        'title': 'New Chat',
        'messages': [],
        'system_prompt': shared.get_global_system_prompt(),
        'created_at': datetime.now().isoformat(),
        'updated_at': datetime.now().isoformat()
    }
    shared.save_sessions(shared.sessions_data)
    return {"success": True, "session_id": sid}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    """Get session by ID"""
    shared.sessions_data = shared.load_sessions()
    if session_id not in shared.sessions_data:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True, "session": shared.sessions_data[session_id]}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete session"""
    shared.sessions_data = shared.load_sessions()
    if session_id not in shared.sessions_data:
        raise HTTPException(status_code=404, detail="Not found")
    del shared.sessions_data[session_id]
    shared.save_sessions(shared.sessions_data)
    return {"success": True}


@app.put("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    """Update session"""
    shared.sessions_data = shared.load_sessions()
    if session_id not in shared.sessions_data:
        raise HTTPException(status_code=404, detail="Not found")
    
    data = await request.json()
    if 'title' in data:
        shared.sessions_data[session_id]['title'] = data['title']
    if 'system_prompt' in data:
        shared.sessions_data[session_id]['system_prompt'] = data['system_prompt']
    shared.sessions_data[session_id]['updated_at'] = datetime.now().isoformat()
    shared.save_sessions(shared.sessions_data)
    return {"success": True}


@app.get("/api/tts/speakers")
async def get_tts_speakers():
    """Get available TTS speakers/voices"""
    tts = shared.get_tts_provider()
    if not tts:
        return JSONResponse({"success": False, "error": "No TTS provider available"}, status_code=500)
    
    try:
        if hasattr(tts, 'get_speakers'):
            speakers = tts.get_speakers()
        elif hasattr(tts, 'get_voices'):
            speakers = tts.get_voices()
        else:
            speakers = [
                {"id": "Maya", "name": "Maya"},
                {"id": "en", "name": "English (Default)"},
                {"id": "default", "name": "Default"}
            ]
        
        return {
            "success": True,
            "speakers": speakers,
            "provider": tts.provider_name
        }
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/health")
async def health_check():
    """Check health of current provider"""
    provider = shared.get_provider()
    if not provider:
        return {"status": "disconnected", "message": "Provider not available", "provider": "unknown"}
    
    try:
        is_healthy = provider.test_connection()
        status = "connected" if is_healthy else "disconnected"
        return {
            "status": status,
            "provider": provider.provider_name,
            "message": "OK" if is_healthy else "Connection failed"
        }
    except Exception as e:
        return {
            "status": "disconnected",
            "provider": provider.provider_name,
            "message": str(e)
        }


@app.get("/api/providers/status")
async def providers_status():
    """Check status of all providers"""
    try:
        llm_provider = shared.get_provider()
        llm_status = {
            "available": False,
            "provider": "unknown",
            "message": ""
        }
        
        if llm_provider:
            try:
                is_healthy = llm_provider.test_connection()
                llm_status = {
                    "available": is_healthy,
                    "provider": llm_provider.provider_name,
                    "message": "OK" if is_healthy else "Connection failed"
                }
            except Exception as e:
                llm_status = {
                    "available": False,
                    "provider": llm_provider.provider_name,
                    "message": str(e)
                }
        
        tts_p = shared.get_tts_provider()
        tts_status = {
            "available": tts_p is not None,
            "provider": tts_p.provider_name if tts_p else "none",
            "message": "Ready" if tts_p else "Not loaded"
        }
        
        return {
            "success": True,
            "llm": llm_status,
            "tts": tts_status
        }
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/clear")
async def clear_session(request: Request):
    """Clear session messages"""
    data = await request.json()
    sid = data.get('session_id', 'default')
    shared.sessions_data = shared.load_sessions()
    if sid in shared.sessions_data:
        shared.sessions_data[sid]['messages'] = []
        shared.sessions_data[sid]['updated_at'] = datetime.now().isoformat()
        shared.save_sessions(shared.sessions_data)
    return {"success": True}


# ============== PODCAST ENDPOINTS ==============
import os as _os
import time as _time
from pathlib import Path

VP_FILE = Path(shared.DATA_DIR) / 'podcast_voice_profiles.json'
EP_FILE = Path(shared.DATA_DIR) / 'podcast_episodes.json'

def _load_json(path, default):
    try:
        if _os.path.exists(path): 
            return json.loads(open(path, 'r').read())
    except: 
        pass
    return default

def _save_json(path, data):
    with open(path, 'w') as f: 
        json.dump(data, f, indent=2)

@app.get("/api/podcast/voice-profiles")
async def get_voice_profiles():
    """Get podcast voice profiles"""
    profiles = _load_json(VP_FILE, [])
    return {"success": True, "profiles": profiles}

@app.post("/api/podcast/voice-profiles")
async def create_voice_profile(request: Request):
    """Create podcast voice profile"""
    profiles = _load_json(VP_FILE, [])
    data = await request.json()
    data['id'] = data.get('id', f"vp_{int(_time.time())}")
    data['created_at'] = datetime.now().isoformat()
    profiles.append(data)
    _save_json(VP_FILE, profiles)
    return {"success": True, "profile": data}


# ============== LLAMACPP ENDPOINTS ==============
@app.get("/api/llamacpp/server/status")
async def llamacpp_status():
    """Get llama.cpp server status"""
    server_dir = Path(shared.BASE_DIR) / 'models' / 'server'
    binary = None
    for n in ["llama-server.exe", "llama-server", "llama.exe", "llama"]:
        if (server_dir / n).exists():
            binary = n
            break
    return {"success": True, "server_dir": str(server_dir), "binary_found": bool(binary), "binary_name": binary}

@app.post("/api/llamacpp/server/start")
async def llamacpp_start(request: Request):
    """Start llama.cpp server"""
    data = await request.json()
    model = data.get('model', '')
    if not model:
        return JSONResponse({"success": False, "error": "Model required"}, status_code=400)
    
    server_dir = Path(shared.BASE_DIR) / 'models' / 'server'
    binary = None
    for n in ["llama-server.exe", "llama-server", "llama.exe", "llama"]:
        if (server_dir / n).exists():
            binary = n
            break
    if not binary:
        return JSONResponse({"success": False, "error": "Binary not found"}, status_code=400)
    
    m_path = model if _os.path.isabs(model) else None
    if not m_path:
        for p in [Path(shared.BASE_DIR) / 'models' / 'llm' / model, server_dir / model]:
            if p.exists():
                m_path = str(p)
                break
    
    if not m_path:
        return JSONResponse({"success": False, "error": "Model file not found"}, status_code=400)
    
    try:
        port = 8080
        try: 
            port = int(shared.load_settings().get('llamacpp', {}).get('base_url', '').split(':')[-1])
        except: pass
        
        import subprocess as sp
        proc = sp.Popen(
            [str(server_dir / binary), "-m", m_path, "-c", "4096", "-ngl", "999", "--host", "0.0.0.0", "--port", str(port)], 
            cwd=str(server_dir), 
            stdout=sp.PIPE, 
            stderr=sp.STDOUT
        )
        return {"success": True, "message": f"Started on port {port}", "pid": proc.pid}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

@app.post("/api/llamacpp/server/stop")
async def llamacpp_stop():
    """Stop llama.cpp server"""
    try:
        import subprocess as sp
        port = 8080
        try: 
            port = int(shared.load_settings().get('llamacpp', {}).get('base_url', '').split(':')[-1])
        except: pass
        return {"success": True, "message": f"Stopped port {port}"}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ============== SERVICES ENDPOINTS ==============
@app.get("/api/services/status")
async def services_status():
    """Get services status"""
    import requests
    tts_r, stt_r = False, False
    try: 
        tts_r = requests.get(f"{shared.TTS_BASE_URL}/health", timeout=2).status_code == 200
    except: 
        pass
    try: 
        stt_r = requests.get(f"{shared.STT_BASE_URL}/health", timeout=2).status_code == 200
    except: 
        pass
    
    return {"success": True, "tts": {"running": tts_r}, "stt": {"running": stt_r}}


# ============== MODELS ENDPOINTS ==============
@app.get("/api/models")
async def get_models():
    """Get available models"""
    provider = shared.get_provider()
    if not provider:
        return JSONResponse({"success": False, "error": "Provider not available"}, status_code=500)
    
    try:
        models = provider.get_models()
        models_data = [{
            "id": m.id,
            "name": m.name,
            "provider": m.provider,
            "context_length": m.context_length,
            "description": m.description
        } for m in models]
        return {"success": True, "models": models_data, "provider": provider.provider_name}
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ============== HTTP FALLBACK ENDPOINTS ==============
@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    """Streaming chat endpoint (HTTP fallback for Flask compatibility)."""
    from fastapi.responses import StreamingResponse
    import json
    
    data = await request.json()
    user_message = data.get('message', '')
    session_id = data.get('session_id', 'default')
    model = data.get('model')
    system_prompt = data.get('system_prompt', '')
    speaker = data.get('speaker', 'default')
    
    if not llm_provider:
        return JSONResponse({"success": False, "error": "Provider not available"}, status_code=500)
    
    if not llm_provider.supports_streaming():
        return JSONResponse({"success": False, "error": "Provider does not support streaming"}, status_code=400)
    
    try:
        messages = []
        if session_id in shared.sessions_data:
            raw_messages = shared.sessions_data[session_id].get('messages', [])
            for msg in raw_messages:
                if isinstance(msg, dict):
                    messages.append(ChatMessage(role=msg.get('role', 'user'), content=msg.get('content', '')))
                elif hasattr(msg, 'role') and hasattr(msg, 'content'):
                    messages.append(msg)
        
        if system_prompt:
            messages.insert(0, ChatMessage(role="system", content=system_prompt))
        
        messages.append(ChatMessage(role="user", content=user_message))
        
        stream_generator = llm_provider.chat_completion(
            messages=messages,
            model=model or llm_provider.config.model,
            stream=True
        )
        
        async def generate():
            try:
                ai_message = ""
                thinking = ""
                
                for response_chunk in stream_generator:
                    if response_chunk.content:
                        ai_message += response_chunk.content
                        yield f"data: {json.dumps({'type': 'content', 'content': response_chunk.content})}\n\n"
                    
                    if response_chunk.thinking or response_chunk.reasoning:
                        thinking += response_chunk.thinking or response_chunk.reasoning
                
                if session_id in shared.sessions_data:
                    shared.sessions_data[session_id]['messages'].append({
                        "role": "assistant",
                        "content": ai_message,
                        "thinking": thinking
                    })
                    shared.save_sessions(shared.sessions_data)
                
                yield f"data: {json.dumps({'type': 'done', 'thinking': thinking, 'session_id': session_id})}\n\n"
                
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        
        return StreamingResponse(generate(), media_type="text/event-stream")
    
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)
@app.post("/api/conversation/greeting")
async def greeting(speaker: str = "default"):
    """HTTP fallback for greeting"""
    if not tts_provider:
        return JSONResponse({"success": False, "error": "No TTS"})
    
    try:
        greeting_text = "Hello! I'm listening. How can I help you today?"
        
        if hasattr(tts_provider, 'generate_tts'):
            result = tts_provider.generate_tts(text=greeting_text, speaker=speaker, language="en")
        else:
            result = tts_provider.generate_audio(text=greeting_text, speaker=speaker, language="en")
        
        if result and result.get('success'):
            return {
                "success": True,
                "text": greeting_text,
                "audio": result.get('audio', ''),
                "sample_rate": result.get('sample_rate', 24000)
            }
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})


# ============== TTS ENDPOINTS ==============
def resolve_speaker_tts(data: dict):
    """Resolve speaker and language from request data."""
    speaker = data.get('speaker', 'default')
    language = data.get('language', 'en')
    
    if not speaker or speaker.lower() == 'default':
        speaker = 'default'
    
    return speaker, language


@app.post("/api/stt/float32")
async def stt_float32(request: Request):
    """STT endpoint for Float32 audio - proxies to STT service."""
    try:
        content_type = request.headers.get('content-type', '')
        
        audio_bytes = None
        sample_rate = request.headers.get('X-Sample-Rate', '24000')
        
        if 'multipart/form-data' in content_type:
            form = await request.form()
            file = form.get('file')
            if file:
                audio_bytes = await file.read()
        else:
            audio_bytes = await request.body()
        
        if not audio_bytes:
            return JSONResponse({"detail": "No audio data provided"}, status_code=400)
        
        # Forward to STT service
        stt_url = f"{shared.STT_BASE_URL}/transcribe"
        response = requests.post(
            stt_url,
            headers={'X-Sample-Rate': sample_rate, 'Content-Type': 'application/octet-stream'},
            data=audio_bytes,
            timeout=30
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            return JSONResponse({
                "detail": f"STT service error: {response.status_code}",
                "stt_response": response.text[:500] if response.text else "Empty response"
            }, status_code=response.status_code)
    except requests.exceptions.ConnectionError as e:
        return JSONResponse({"detail": f"STT service unavailable at {shared.STT_BASE_URL}: {str(e)}"}, status_code=503)
    except Exception as e:
        return JSONResponse({"detail": str(e)}, status_code=500)


@app.post("/api/stt")
async def stt_endpoint(request: Request):
    """Standard STT endpoint for file uploads."""
    try:
        # Handle multipart form data
        form = await request.form()
        audio_file = form.get('audio')
        
        if not audio_file:
            return JSONResponse({"detail": "No audio file provided"}, status_code=400)
        
        audio_bytes = await audio_file.read()
        
        # Forward to STT service
        stt_url = f"{shared.STT_BASE_URL}/transcribe"
        files = {'audio': (audio_file.filename, audio_bytes, audio_file.content_type)}
        response = requests.post(stt_url, files=files, timeout=30)
        
        if response.status_code == 200:
            return response.json()
        else:
            return JSONResponse({"detail": f"STT service error: {response.status_code}"}, status_code=response.status_code)
    except Exception as e:
        return JSONResponse({"detail": str(e)}, status_code=500)


@app.post("/api/tts")
async def tts_endpoint(request: Request):
    """Standard TTS endpoint - returns complete audio."""
    if not tts_provider:
        return JSONResponse({"success": False, "error": "No TTS provider available"}, status_code=500)
    
    try:
        data = await request.json()
        text = shared.remove_emojis(data.get('text', ''))
        if not text:
            return JSONResponse({"success": False, "error": "Text required"}, status_code=400)
        
        final_speaker, language = resolve_speaker_tts(data)
        
        if hasattr(tts_provider, 'generate_tts'):
            result = tts_provider.generate_tts(text=text, speaker=final_speaker, language=language)
        elif hasattr(tts_provider, 'generate_audio'):
            result = tts_provider.generate_audio(text=text, speaker=final_speaker, language=language)
        else:
            return JSONResponse({"success": False, "error": "Provider missing TTS method"}, status_code=500)
        
        if result and result.get('success'):
            return {
                "success": True,
                "audio": result.get('audio', ''),
                "sample_rate": result.get('sample_rate', 24000)
            }
        else:
            return JSONResponse({"success": False, "error": result.get('error', 'TTS failed')}, status_code=500)
            
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/tts/stream")
async def tts_stream_endpoint(request: Request):
    """Streaming TTS endpoint."""
    if not tts_provider:
        return JSONResponse({"success": False, "error": "No TTS provider available"}, status_code=500)
    
    try:
        data = await request.json()
        text = shared.remove_emojis(data.get('text', ''))
        if not text:
            return JSONResponse({"success": False, "error": "Text required"}, status_code=400)
        
        final_speaker, language = resolve_speaker_tts(data)
        
        if not hasattr(tts_provider, 'generate_audio_stream'):
            return JSONResponse({"success": False, "error": "Provider doesn't support streaming"}, status_code=500)
        
        from fastapi.responses import StreamingResponse
        import io
        
        async def generate():
            try:
                for audio_chunk, sr, timing in tts_provider.generate_audio_stream(
                    text=text,
                    speaker=final_speaker,
                    language=language,
                    chunk_size=12,
                    temperature=0.9,
                    top_k=50,
                    repetition_penalty=1.05,
                    top_p=0.95,
                    append_silence=False,
                    max_new_tokens=1024
                ):
                    if audio_chunk is not None and len(audio_chunk) > 0:
                        pcm_int16 = (audio_chunk * 32767).astype(np.int16).tobytes()
                        yield pcm_int16
            except Exception as e:
                print(f"[TTS STREAM] Error: {e}")
        
        return StreamingResponse(generate(), media_type="audio/wav")
    
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.post("/api/tts/stream/server-sent-events")
async def tts_stream_sse_endpoint(request: Request):
    """SSE streaming TTS endpoint."""
    from fastapi.responses import StreamingResponse
    import asyncio
    
    print(f"[TTS SSE] Request received")
    
    if not tts_provider:
        print(f"[TTS SSE] No TTS provider")
        return JSONResponse({"success": False, "error": "No TTS provider available"}, status_code=500)
    
    try:
        content_type = request.headers.get('content-type', '')
        
        if 'application/json' in content_type:
            data = await request.json()
        elif 'multipart/form-data' in content_type or 'application/x-www-form-urlencoded' in content_type:
            form = await request.form()
            data = {}
            for key, value in form.items():
                if hasattr(value, 'file'):
                    data[key] = value
                else:
                    data[key] = value
        else:
            try:
                body = await request.body()
                import json as json_module
                data = json_module.loads(body)
            except:
                data = {}
        
        text = data.get('text', '')
        if isinstance(text, list):
            text = ' '.join(text)
        text = shared.remove_emojis(str(text))
        print(f"[TTS SSE] Text: {text[:50]}...")
        
        if not text:
            return JSONResponse({"success": False, "error": "Text required"}, status_code=400)
        
        final_speaker = data.get('speaker', 'default')
        language = data.get('language', 'en')
        
        if not final_speaker or final_speaker.lower() == 'default':
            final_speaker = 'default'
        
        print(f"[TTS SSE] Speaker: {final_speaker}, Language: {language}")
        
        if not hasattr(tts_provider, 'generate_audio_stream'):
            print(f"[TTS SSE] No generate_audio_stream method")
            return JSONResponse({"success": False, "error": "Provider doesn't support streaming"}, status_code=500)
        
        def generate_tts():
            try:
                print(f"[TTS SSE] Starting generation")
                for audio_chunk, sr, timing in tts_provider.generate_audio_stream(
                    text=text,
                    speaker=final_speaker,
                    language=language,
                    chunk_size=12,
                    temperature=0.9,
                    top_k=50,
                    repetition_penalty=1.05,
                    top_p=0.95,
                    append_silence=False,
                    max_new_tokens=1024
                ):
                    if audio_chunk is not None and len(audio_chunk) > 0:
                        pcm_int16 = (audio_chunk * 32767).astype(np.int16)
                        audio_b64 = base64.b64encode(pcm_int16.tobytes()).decode('utf-8')
                        yield f"data: {json.dumps({'type': 'chunk', 'audio_b64': audio_b64, 'sample_rate': sr})}\n\n"
                print(f"[TTS SSE] Generation complete")
            except Exception as e:
                print(f"[TTS SSE] Generation error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        
        async def generate():
            try:
                loop = asyncio.get_event_loop()
                for chunk in await loop.run_in_executor(None, generate_tts):
                    yield chunk
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            except Exception as e:
                print(f"[TTS SSE] Async error: {e}")
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"
        
        return StreamingResponse(generate(), media_type="text/event-stream")
    
    except Exception as e:
        print(f"[TTS SSE] Outer error: {e}")
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


# ============== MAIN ==============
if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("Omnix FastAPI Server - Ultra Low Latency")
    print("=" * 50)
    print(f"WebSocket: ws://{HOST}:{PORT}/ws/conversation")
    print("=" * 50 + "\n")
    
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info"
    )
