"""
Real-time WebSocket Server for Streaming Chat & Voice
This provides WebSocket endpoints for:
- Streaming LLM responses (word-by-word)
- Streaming TTS audio
- Full real-time voice pipeline

Usage:
    python realtime_server.py
    
Or run alongside main Flask app.
"""

import asyncio
import base64
import json
import logging
import os
import queue
import threading
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional

import numpy as np
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# CONFIGURATION
# ============================================================

# Paths
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

def load_settings():
    """Load settings from the Flask app's settings file"""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {}

def get_llm_config():
    """Get LLM configuration from settings"""
    settings = load_settings()
    provider = settings.get('provider', 'cerebras')
    
    if provider == 'cerebras':
        return {
            'provider': 'cerebras',
            'api_key': settings.get('cerebras', {}).get('api_key', os.environ.get("CEREBRAS_API_KEY", "")),
            'model': settings.get('cerebras', {}).get('model', 'llama-3.3-70b-versatile'),
            'base_url': 'https://api.cerebras.ai'
        }
    elif provider == 'openrouter':
        return {
            'provider': 'openrouter',
            'api_key': settings.get('openrouter', {}).get('api_key', os.environ.get("OPENROUTER_API_KEY", "")),
            'model': settings.get('openrouter', {}).get('model', 'openai/gpt-4o-mini'),
            'base_url': 'https://openrouter.ai/api/v1'
        }
    else:
        return {
            'provider': 'lmstudio',
            'base_url': settings.get('lmstudio', {}).get('base_url', 'http://localhost:1234')
        }

# LLM Configuration (will be loaded from settings file)
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "cerebras")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.cerebras.ai")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama-3.3-70b-versatile")

# TTS Configuration (Chatterbox)
TTS_BASE_URL = os.environ.get("TTS_BASE_URL", "http://localhost:8020")

# STT Configuration
STT_BASE_URL = os.environ.get("STT_BASE_URL", "http://localhost:8000")

# Server Configuration
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8001"))

# Audio Configuration
AUDIO_SAMPLE_RATE = 24000  # Chatterbox uses 24kHz
AUDIO_CHUNK_SIZE = 2048

# ============================================================
# DATA MODELS
# ============================================================

class ChatMessage(BaseModel):
    role: str = "user"
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 4096

class TTSRequest(BaseModel):
    text: str
    speaker: Optional[str] = "en/femalenord"
    language: Optional[str] = "en"

class StreamChunk(BaseModel):
    type: str  # "text", "audio", "transcript", "error", "done"
    data: Any
    timestamp: Optional[float] = None

# ============================================================
# LLM STREAMING
# ============================================================

async def stream_llm_response(messages: list[dict], model: str = None) -> AsyncIterator[str]:
    """Stream LLM response word by word"""
    import aiohttp
    
    # Load config from settings file (same as Flask app)
    config = get_llm_config()
    provider = config['provider']
    api_key = config.get('api_key', '')
    base_url = config.get('base_url', 'https://api.cerebras.ai')
    default_model = config.get('model', 'llama-3.3-70b-versatile')
    
    model = model or default_model
    
    # Build headers based on provider
    headers = {"Content-Type": "application/json"}
    
    if provider == "cerebras":
        headers["Authorization"] = f"Bearer {api_key}"
        url = f"{base_url}/v1/chat/completions"
        logger.info(f"Using Cerebras: model={model}, url={url}")
    elif provider == "openrouter":
        headers["Authorization"] = f"Bearer {api_key}"
        headers["HTTP-Referer"] = "http://localhost:8001"
        headers["X-Title"] = "Realtime Chat"
        url = f"{base_url}/chat/completions"
        logger.info(f"Using OpenRouter: model={model}")
    else:  # lmstudio
        url = f"{base_url}/v1/chat/completions"
        logger.info(f"Using LM Studio: model={model}")
    
    # Convert messages to OpenAI format
    formatted_messages = []
    for msg in messages:
        if isinstance(msg, dict):
            formatted_messages.append(msg)
        elif isinstance(msg, ChatMessage):
            formatted_messages.append({"role": msg.role, "content": msg.content})
    
    payload = {
        "model": model,
        "messages": formatted_messages,
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 4096
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status != 200:
                    error_text = await response.text()
                    yield f"error:HTTP {response.status}: {error_text}"
                    return
                
                async for line in response.content:
                    line = line.decode('utf-8').strip()
                    if not line or not line.startswith('data:'):
                        continue
                    
                    if line == 'data: [DONE]':
                        break
                    
                    try:
                        data = json.loads(line[5:])
                        if 'choices' in data and len(data['choices']) > 0:
                            delta = data['choices'][0].get('delta', {})
                            content = delta.get('content', '')
                            if content:
                                yield content
                    except json.JSONDecodeError:
                        continue
                        
    except Exception as e:
        yield f"error:{str(e)}"

async def rechunk_to_words(text_stream: AsyncIterator[str]) -> AsyncIterator[str]:
    """Rechunk token stream to word stream for better TTS"""
    import re
    
    buffer = ""
    space_re = re.compile(r'\s+')
    
    async for delta in text_stream:
        buffer = buffer + delta
        while True:
            match = space_re.search(buffer)
            if match is None:
                break
            chunk = buffer[:match.start()]
            buffer = buffer[match.end():]
            if chunk:
                yield chunk + " "
    
    if buffer:
        yield buffer

# ============================================================
# TTS STREAMING (Qwen3-TTS - true streaming via WebSocket)
# ============================================================

async def stream_tts_audio(text: str, speaker: str = "en/femalenord") -> AsyncIterator[tuple[bytes, int]]:
    """Stream TTS audio using Chatterbox TTS"""
    import aiohttp
    
    # Clean text
    text = text.strip()
    if not text:
        return
    
    logger.info(f"TTS request: text='{text[:50]}...', speaker='{speaker}'")
    
    # Use Chatterbox TTS HTTP API
    # The endpoint expects: {"text": ..., "language": "en"}
    # Optional: "voice_clone_id" for custom voices
    try:
        async with aiohttp.ClientSession() as session:
            request_data = {
                "text": text,
                "language": "en"
            }
            
            # Handle custom voice clones (speaker names that aren't standard)
            if speaker and not speaker.startswith("en/"):
                request_data["voice_clone_id"] = speaker
            
            logger.info(f"Sending TTS request to {TTS_BASE_URL}/tts: {request_data}")
            
            async with session.post(
                f"{TTS_BASE_URL}/tts",
                json=request_data,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"TTS HTTP {response.status}: {error_text}")
                    yield (f"error:HTTP {response.status}: {error_text[:200]}".encode(), 0)
                    return
                
                result = await response.json()
                logger.info(f"TTS response: success={result.get('success')}")
                
                if result.get("success") and result.get("audio"):
                    audio_b64 = result["audio"]
                    audio_bytes = base64.b64decode(audio_b64)
                    sr = result.get("sample_rate", 24000)
                    
                    # Yield in chunks for streaming playback
                    chunk_size = AUDIO_CHUNK_SIZE * 2  # 16-bit samples
                    for i in range(0, len(audio_bytes), chunk_size):
                        chunk = audio_bytes[i:i + chunk_size]
                        if chunk:
                            yield (chunk, sr)
                else:
                    error = result.get('error', 'TTS failed')
                    logger.error(f"TTS error: {error}")
                    yield (f"error:{error}".encode(), 0)
                    
    except asyncio.TimeoutError:
        logger.error("TTS timeout")
        yield (b"error:TTS timeout", 0)
    except Exception as e:
        logger.error(f"TTS error: {e}")
        yield (f"error:{str(e)}".encode(), 0)

# ============================================================
# STT (Transcription)
# ============================================================

async def transcribe_audio(audio_data: bytes) -> str:
    """Transcribe audio using Parakeet STT"""
    import aiohttp
    
    try:
        async with aiohttp.ClientSession() as session:
            form = aiohttp.FormData()
            form.add_field('file', audio_data, filename='audio.wav', content_type='audio/wav')
            
            async with session.post(
                f"{STT_BASE_URL}/transcribe",
                data=form,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status != 200:
                    return f"error:HTTP {response.status}"
                
                result = await response.json()
                if result.get('success'):
                    # Combine all segments
                    segments = result.get('segments', [])
                    text = ' '.join([seg.get('text', '') for seg in segments])
                    return text
                else:
                    return result.get('message', 'Transcription failed')
                    
    except Exception as e:
        return f"error:{str(e)}"

# ============================================================
# WEBSOCKET HANDLERS
# ============================================================

app = FastAPI(title="Realtime Voice Chat API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "services": {
            "llm": LLM_PROVIDER,
            "tts": TTS_BASE_URL,
            "stt": STT_BASE_URL
        }
    }

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """WebSocket endpoint for streaming chat"""
    await websocket.accept()
    
    try:
        while True:
            # Receive message
            data = await websocket.receive_text()
            request_data = json.loads(data)
            
            messages = request_data.get("messages", [])
            model = request_data.get("model")
            
            # Stream response
            async for chunk in stream_llm_response(messages, model):
                await websocket.send_text(json.dumps({
                    "type": "text",
                    "data": chunk
                }))
            
            # Signal completion
            await websocket.send_text(json.dumps({
                "type": "done"
            }))
            
    except WebSocketDisconnect:
        logger.info("Client disconnected from chat")
    except Exception as e:
        logger.error(f"Chat error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "data": str(e)
            }))
        except:
            pass

@app.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    """WebSocket endpoint for streaming TTS"""
    await websocket.accept()
    
    try:
        while True:
            # Receive TTS request
            data = await websocket.receive_text()
            request_data = json.loads(data)
            
            text = request_data.get("text", "")
            speaker = request_data.get("speaker", "en/femalenord")
            
            if not text:
                continue
            
            # Stream audio
            async for audio_chunk, sample_rate in stream_tts_audio(text, speaker):
                # Send as base64
                audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                await websocket.send_text(json.dumps({
                    "type": "audio",
                    "data": audio_b64,
                    "sample_rate": sample_rate
                }))
            
            # Signal completion
            await websocket.send_text(json.dumps({
                "type": "done"
            }))
            
    except WebSocketDisconnect:
        logger.info("Client disconnected from TTS")
    except Exception as e:
        logger.error(f"TTS error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "data": str(e)
            }))
        except:
            pass

@app.websocket("/ws/voice")
async def websocket_voice(websocket: WebSocket):
    """
    Full voice pipeline WebSocket:
    1. Receive audio from client
    2. Transcribe with STT
    3. Generate response with LLM
    4. Stream TTS audio back
    """
    await websocket.accept()
    
    try:
        # Configuration
        config = await websocket.receive_text()
        config_data = json.loads(config)
        system_prompt = config_data.get("system_prompt", "You are a helpful AI assistant.")
        model = config_data.get("model", LLM_MODEL)
        
        # Build conversation context
        messages = [{"role": "system", "content": system_prompt}]
        
        # Audio buffer
        audio_buffer = bytes()
        
        while True:
            # Receive message (could be audio or text)
            try:
                message = await websocket.receive_text()
            except Exception:
                break
            
            message_data = json.loads(message)
            msg_type = message_data.get("type", "audio")
            
            if msg_type == "audio":
                # Receive audio chunk
                audio_b64 = message_data.get("data", "")
                if audio_b64:
                    audio_chunk = base64.b64decode(audio_b64)
                    audio_buffer += audio_chunk
                    
                    # Check if this is end of audio (could be based on silence or explicit signal)
                    # For now, we'll wait for explicit "done" signal
                    
            elif msg_type == "audio_done":
                # Process the accumulated audio
                if audio_buffer:
                    # Send "transcribing" status
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "data": "transcribing"
                    }))
                    
                    # Transcribe
                    transcript = await transcribe_audio(audio_buffer)
                    
                    if transcript.startswith("error:"):
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "data": transcript
                        }))
                    else:
                        # Send transcript
                        await websocket.send_text(json.dumps({
                            "type": "transcript",
                            "data": transcript
                        }))
                        
                        # Add to conversation
                        messages.append({"role": "user", "content": transcript})
                        
                        # Send "thinking" status
                        await websocket.send_text(json.dumps({
                            "type": "status",
                            "data": "thinking"
                        }))
                        
                        # Stream LLM response (also send to TTS in real-time)
                        response_text = ""
                        tts_buffer = ""
                        
                        async for llm_chunk in stream_llm_response(messages, model):
                            response_text += llm_chunk
                            # Send text chunk
                            await websocket.send_text(json.dumps({
                                "type": "text",
                                "data": llm_chunk
                            }))
                            
                            # Buffer for TTS
                            tts_buffer += llm_chunk
                            
                            # Send to TTS every few words
                            if len(tts_buffer.split()) >= 3:
                                async for audio_chunk, sr in stream_tts_audio(tts_buffer):
                                    audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                                    await websocket.send_text(json.dumps({
                                        "type": "audio",
                                        "data": audio_b64,
                                        "sample_rate": sr
                                    }))
                                tts_buffer = ""
                        
                        # Send any remaining TTS
                        if tts_buffer.strip():
                            async for audio_chunk, sr in stream_tts_audio(tts_buffer):
                                audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                                await websocket.send_text(json.dumps({
                                    "type": "audio",
                                    "data": audio_b64,
                                    "sample_rate": sr
                                }))
                        
                        # Add assistant response to conversation
                        messages.append({"role": "assistant", "content": response_text})
                        
                        # Send done
                        await websocket.send_text(json.dumps({
                            "type": "done"
                        }))
                    
                    # Clear buffer
                    audio_buffer = bytes()
                    
            elif msg_type == "text":
                # Direct text input (not voice)
                text = message_data.get("data", "")
                if text:
                    messages.append({"role": "user", "content": text})
                    
                    await websocket.send_text(json.dumps({
                        "type": "status",
                        "data": "thinking"
                    }))
                    
                    response_text = ""
                    tts_buffer = ""
                    
                    async for llm_chunk in stream_llm_response(messages, model):
                        response_text += llm_chunk
                        await websocket.send_text(json.dumps({
                            "type": "text",
                            "data": llm_chunk
                        }))
                        
                        tts_buffer += llm_chunk
                        if len(tts_buffer.split()) >= 3:
                            async for audio_chunk, sr in stream_tts_audio(tts_buffer):
                                audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                                await websocket.send_text(json.dumps({
                                    "type": "audio",
                                    "data": audio_b64,
                                    "sample_rate": sr
                                }))
                            tts_buffer = ""
                    
                    if tts_buffer.strip():
                        async for audio_chunk, sr in stream_tts_audio(tts_buffer):
                            audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                            await websocket.send_text(json.dumps({
                                "type": "audio",
                                "data": audio_b64,
                                "sample_rate": sr
                            }))
                    
                    messages.append({"role": "assistant", "content": response_text})
                    
                    await websocket.send_text(json.dumps({
                        "type": "done"
                    }))
                    
            elif msg_type == "clear":
                # Clear conversation
                messages = [{"role": "system", "content": system_prompt}]
                await websocket.send_text(json.dumps({
                    "type": "status",
                    "data": "cleared"
                }))
                
    except WebSocketDisconnect:
        logger.info("Client disconnected from voice")
    except Exception as e:
        logger.error(f"Voice pipeline error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "data": str(e)
            }))
        except:
            pass

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    print(f"Starting Realtime Server on ws://{HOST}:{PORT}")
    print(f"Endpoints:")
    print(f"  - Chat: ws://{HOST}:{PORT}/ws/chat")
    print(f"  - TTS:  ws://{HOST}:{PORT}/ws/tts")
    print(f"  - Voice: ws://{HOST}:{PORT}/ws/voice")
    uvicorn.run(app, host=HOST, port=PORT)
