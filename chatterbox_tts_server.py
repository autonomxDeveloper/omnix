"""
Chatterbox TTS Server with WebSocket Streaming Support

Chatterbox is a fast, open-source TTS model by Resemble AI.
- Chatterbox TURBO for real-time conversational AI (~200ms latency)
- Zero-shot voice cloning from reference audio
- English-focused with natural prosody

Requirements:
    pip install chatterbox-tts torch torchaudio

Usage:
    python chatterbox_tts_server.py
"""
import os
import sys

# FIX: Import transformers BEFORE torch/torchvision to avoid circular import
# This must be done before any other imports that might load torchvision
import transformers
import torch
import numpy as np

import asyncio
import base64
import io
import json
import logging
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("TTS_PORT", "8020"))

# Audio settings
SAMPLE_RATE = 24000  # Chatterbox uses 24kHz
CHUNK_SIZE = 8192  # Larger chunks for better throughput

# Speculative TTS phrases (pre-generated for instant response)
SPECULATIVE_FILLERS = [
    "Hmm, let me think about that.",
    "Sure, I can help with that.",
    "Great question!",
    "Let me see...",
    "Okay, give me a moment.",
    "I understand.",
    "Right, let me check that for you.",
    "Interesting! Let me think.",
]

CONVERSATION_GREETINGS = [
    "Hello! I'm ready to chat. How can I help you today?",
    "Hi there! I'm listening. What's on your mind?",
    "Hey! Ready when you are. What would you like to talk about?",
]

# Cache for pre-generated speculative audio
speculative_cache = {}  # text -> (audio_bytes, sample_rate)

# Performance settings
import torch
if torch.cuda.is_available():
    torch.backends.cuda.matmul.allow_tf32 = True  # Allow TF32 for faster matmul
    torch.backends.cudnn.allow_tf32 = True  # Allow TF32 for cudnn

# ============================================================
# MODEL LOADING
# ============================================================

_model = None
_model_lock = threading.Lock()
_model_type = "unknown"

def load_model():
    """Load Chatterbox TTS Turbo model (fastest, ~200ms latency)"""
    global _model, _model_type
    if _model is not None:
        return _model
    
    try:
        import torch
        
        # Check for CUDA
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Using device: {device}")
        
        # Try to load ChatterboxTurboTTS first (fastest for real-time)
        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            
            logger.info("Loading Chatterbox TTS TURBO model...")
            _model = ChatterboxTurboTTS.from_pretrained(device=device)
            _model_type = "turbo"
            logger.info(f"Chatterbox TTS TURBO model loaded successfully!")
            
        except (ImportError, AttributeError) as e:
            logger.warning(f"ChatterboxTurboTTS not available: {e}")
            # Fall back to regular ChatterboxTTS if Turbo not available
            from chatterbox.tts import ChatterboxTTS
            
            logger.info("Loading Chatterbox TTS model (Turbo not available in this version)...")
            _model = ChatterboxTTS.from_pretrained(device=device)
            _model_type = "standard"
            logger.info(f"Chatterbox TTS model loaded successfully!")
            
            # Try to optimize with torch.compile for faster inference (PyTorch 2.0+)
            if device == "cuda" and hasattr(torch, 'compile'):
                try:
                    logger.info("Optimizing model with torch.compile...")
                    # Compile the T3 model (main text-to-speech model)
                    if hasattr(_model, 't3'):
                        _model.t3 = torch.compile(_model.t3, mode="reduce-overhead")
                    if hasattr(_model, 's3gen'):
                        _model.s3gen = torch.compile(_model.s3gen, mode="reduce-overhead")
                    logger.info("Model optimized with torch.compile!")
                except Exception as compile_err:
                    logger.warning(f"Could not compile model: {compile_err}")
        
        logger.info(f"Sample rate: {_model.sr}")
        return _model
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise

def get_model():
    """Get or load the model"""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = load_model()
    return _model

# ============================================================
# VOICE CLONING
# ============================================================

class VoiceCloneManager:
    """Manages voice clones (reference audio for voice cloning)"""
    
    def __init__(self):
        self.voices = {}  # voice_id -> {'audio_path': str path}
        self.voices_dir = Path(__file__).parent / "voice_clones"
        self.voices_dir.mkdir(exist_ok=True)
    
    def create_voice_clone(self, voice_id: str, audio_path: str):
        """Store reference audio for voice cloning"""
        # Copy to persistent storage
        import shutil
        
        persistent_path = self.voices_dir / f"{voice_id}.wav"
        
        try:
            shutil.copy(audio_path, persistent_path)
            logger.info(f"Copied voice clone audio to: {persistent_path}")
        except Exception as e:
            logger.warning(f"Could not copy voice clone audio: {e}")
            persistent_path = Path(audio_path)
        
        self.voices[voice_id] = {
            'audio_path': str(persistent_path)
        }
        logger.info(f"Created voice clone reference: {voice_id}")
        return True
    
    def get_voice(self, voice_id: str):
        """Get voice info by ID"""
        voice = self.voices.get(voice_id)
        if voice:
            return voice
        
        # Try to load from persistent storage
        persistent_path = self.voices_dir / f"{voice_id}.wav"
        if persistent_path.exists():
            self.voices[voice_id] = {
                'audio_path': str(persistent_path)
            }
            logger.info(f"Loaded voice clone from disk: {voice_id}")
            return self.voices[voice_id]
        
        return None
    
    def load_all_voices(self):
        """Load all voice clones from persistent storage"""
        for wav_file in self.voices_dir.glob("*.wav"):
            voice_id = wav_file.stem
            self.voices[voice_id] = {
                'audio_path': str(wav_file)
            }
            logger.info(f"Loaded voice clone: {voice_id}")
        
        logger.info(f"Loaded {len(self.voices)} voice clones from disk")

voice_manager = VoiceCloneManager()

# ============================================================
# TTS GENERATION
# ============================================================

import re

def split_text_into_sentences(text):
    """Split text into sentences for streaming TTS"""
    # Split on sentence boundaries
    sentences = re.split(r'(?<=[.!?])\s+', text)
    # Filter out empty sentences
    return [s.strip() for s in sentences if s.strip()]

def generate_speech(
    text: str,
    voice_clone_id: str = None,
    voice_name: str = None,
    instruct: str = None,
    language: str = "en",
    stream: bool = False,
    exaggeration: float = 0.5,
    cfg_weight: float = 0.5,
    temperature: float = 0.8
):
    """Generate speech using Chatterbox TTS
    
    Args:
        text: Text to synthesize
        voice_clone_id: ID of voice clone to use (reference audio)
        voice_name: Not used (for compatibility)
        instruct: Not used (for compatibility)
        language: Not used - Chatterbox is English-focused
        stream: Whether to stream output (yields chunks)
        exaggeration: Controls expressiveness (0.0-1.0, higher = more expressive)
        cfg_weight: CFG weight for generation (ignored by Turbo)
        temperature: Sampling temperature
    """
    model = get_model()
    start_time = time.time()
    func_start = start_time
    
    try:
        logger.info(f"[TTS] Generating speech for text: {text[:50]}...")
        
        # Get reference audio for voice cloning if specified
        audio_prompt_path = None
        if voice_clone_id:
            voice_info = voice_manager.get_voice(voice_clone_id)
            if voice_info:
                audio_prompt_path = voice_info['audio_path']
                logger.info(f"[TTS] Using voice clone: {voice_clone_id}")
        
        prep_time = (time.time() - start_time) * 1000
        start_time = time.time()
        
        # Generate audio with no_grad for performance
        # Note: Turbo ignores exaggeration and cfg_weight
        with torch.no_grad():
            audio_tensor = model.generate(
                text,
                audio_prompt_path=audio_prompt_path,
                temperature=temperature
            )
        
        gen_time = (time.time() - start_time) * 1000
        total_time = (time.time() - func_start) * 1000
        logger.info(f"[TTS] TIMING - prep: {prep_time:.0f}ms, generate: {gen_time:.0f}ms, total: {total_time:.0f}ms for '{text[:30]}...'")
        yield audio_tensor
            
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise


async def generate_speech_streaming(
    text: str,
    voice_clone_id: str = None,
    voice_name: str = None,
    instruct: str = None,
    language: str = "en"
) -> AsyncIterator[tuple[bytes, int]]:
    """Generate speech with streaming audio chunks - streams sentence by sentence for faster perceived response"""
    
    try:
        model = get_model()
        
        # Get reference audio for voice cloning if specified
        audio_prompt_path = None
        if voice_clone_id:
            voice_info = voice_manager.get_voice(voice_clone_id)
            if voice_info:
                audio_prompt_path = voice_info['audio_path']
        
        # Split text into sentences for streaming
        sentences = split_text_into_sentences(text)
        
        if not sentences:
            sentences = [text]  # Fallback if no sentence boundaries found
        
        logger.info(f"Streaming {len(sentences)} sentences...")
        
        # Collect all audio first for consistent normalization
        all_audio = []
        
        # Process each sentence separately for streaming
        for i, sentence in enumerate(sentences):
            if not sentence.strip():
                continue
                
            logger.info(f"Generating sentence {i+1}/{len(sentences)}: {sentence[:30]}...")
            
            # Generate audio for this sentence
            with torch.no_grad():
                audio_tensor = model.generate(
                    sentence,
                    audio_prompt_path=audio_prompt_path,
                    exaggeration=0.5,
                    cfg_weight=0.5,
                    temperature=0.8
                )
            
            # Convert tensor to numpy
            if hasattr(audio_tensor, 'cpu'):
                wav = audio_tensor.cpu().numpy().flatten()
            else:
                wav = audio_tensor.flatten()
            
            all_audio.append(wav)
        
        # Concatenate all sentences
        if all_audio:
            full_wav = np.concatenate(all_audio)
        else:
            full_wav = np.array([])
        
        # Normalize the ENTIRE audio consistently (not per-sentence)
        max_val = np.max(np.abs(full_wav)) if len(full_wav) > 0 else 1.0
        if max_val > 0:
            full_wav = full_wav / max_val * 0.90  # 90% max to leave headroom
        
        # Apply gentle high-pass filter to remove DC offset
        if len(full_wav) > 100:
            window_size = 100
            moving_avg = np.convolve(full_wav, np.ones(window_size)/window_size, mode='same')
            full_wav = full_wav - moving_avg
        
        # Convert to 16-bit PCM with clipping protection
        wav_int16 = np.clip(full_wav * 32767, -32768, 32767).astype(np.int16)
        
        # Yield in chunks for streaming
        for j in range(0, len(wav_int16), CHUNK_SIZE):
            chunk = wav_int16[j:j+CHUNK_SIZE]
            yield (chunk.tobytes(), SAMPLE_RATE)
            
    except Exception as e:
        logger.error(f"Error in streaming generation: {e}")
        import traceback
        logger.error(traceback.format_exc())
        yield (f"error:{str(e)}".encode(), 0)


async def generate_speech_batch(
    text: str,
    voice_clone_id: str = None,
    voice_name: str = None,
    instruct: str = None,
    language: str = "en"
) -> tuple[bytes, int]:
    """Generate speech (batch mode)"""
    
    try:
        all_wav = []
        
        # Generate full audio
        for audio_tensor in generate_speech(
            text=text,
            voice_clone_id=voice_clone_id,
            voice_name=voice_name,
            instruct=instruct,
            language=language,
            stream=False
        ):
            # Convert tensor to numpy
            if hasattr(audio_tensor, 'cpu'):
                wav = audio_tensor.cpu().numpy().flatten()
            else:
                wav = audio_tensor.flatten()
            
            all_wav.append(wav)
        
        # Concatenate all frames
        if all_wav:
            full_wav = np.concatenate(all_wav)
        else:
            full_wav = np.array([])
        
        # Normalize audio to prevent clipping and improve quality
        # First, find the max absolute value
        max_val = np.max(np.abs(full_wav)) if len(full_wav) > 0 else 1.0
        
        # Normalize to 95% of max range to prevent clipping
        if max_val > 0:
            full_wav = full_wav / max_val * 0.95
        
        # Apply gentle high-pass filter to remove DC offset
        # Simple implementation: subtract moving average
        if len(full_wav) > 100:
            window_size = 100
            moving_avg = np.convolve(full_wav, np.ones(window_size)/window_size, mode='same')
            full_wav = full_wav - moving_avg
        
        # Convert to 16-bit PCM with proper clipping protection
        wav_int16 = np.clip(full_wav * 32767, -32768, 32767).astype(np.int16)
        return wav_int16.tobytes(), SAMPLE_RATE
        
    except Exception as e:
        logger.error(f"Error in batch generation: {e}")
        raise

# ============================================================
# FASTAPI APP
# ============================================================

def pregenerate_speculative():
    """Pre-generate audio for filler phrases to enable instant response"""
    global speculative_cache
    
    model = get_model()
    logger.info("[SPECULATIVE] Pre-generating filler phrases...")
    
    all_phrases = SPECULATIVE_FILLERS + CONVERSATION_GREETINGS
    
    for phrase in all_phrases:
        try:
            start_time = time.time()
            with torch.no_grad():
                audio_tensor = model.generate(phrase, temperature=0.8)
            
            # Convert to PCM bytes with normalization
            if hasattr(audio_tensor, 'cpu'):
                wav = audio_tensor.cpu().numpy().flatten()
            else:
                wav = audio_tensor.flatten()
            
            # Normalize to prevent clipping
            max_val = np.max(np.abs(wav)) if len(wav) > 0 else 1.0
            if max_val > 0:
                wav = wav / max_val * 0.95
            
            wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
            
            speculative_cache[phrase] = (wav_int16.tobytes(), SAMPLE_RATE)
            gen_time = (time.time() - start_time) * 1000
            logger.info(f"[SPECULATIVE] Cached: '{phrase[:30]}...' ({gen_time:.0f}ms)")
            
        except Exception as e:
            logger.error(f"[SPECULATIVE] Error pre-generating '{phrase[:20]}...': {e}")
    
    logger.info(f"[SPECULATIVE] Cache ready with {len(speculative_cache)} phrases")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup/shutdown events"""
    # Startup: Load model synchronously for faster first request
    logger.info("Pre-loading TTS model...")
    try:
        model = get_model()
        # Warmup the model with a short text to prime CUDA kernels
        logger.info("Warming up model...")
        import torch
        with torch.no_grad():
            _ = model.generate("Hello", exaggeration=0.5, cfg_weight=0.5, temperature=0.8)
        logger.info("Model ready!")
        
        # Load persisted voice clones from disk
        voice_manager.load_all_voices()
        
        # Pre-generate speculative audio for instant response
        pregenerate_speculative()
        
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
    
    yield  # Application runs here
    
    # Shutdown: cleanup if needed
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

app = FastAPI(title="Chatterbox TTS Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str
    voice_clone_id: str = None
    voice: str = None
    instruct: str = None
    language: str = "en"
    exaggeration: float = 0.5
    cfg_weight: float = 0.3  # Lower = faster (0.3 instead of 0.5)
    temperature: float = 0.8
    fast_mode: bool = True  # Enable fast mode by default

class VoiceCloneRequest(BaseModel):
    voice_id: str
    ref_text: str = ""

@app.get("/health")
async def health_check():
    """Health check with performance info"""
    import torch as torch_module
    cuda_available = torch_module.cuda.is_available()
    cuda_device = torch_module.cuda.get_device_name(0) if cuda_available else "N/A"
    
    return {
        "status": "healthy" if _model else "loading",
        "model": f"chatterbox-tts-{_model_type}",
        "model_type": _model_type,
        "cuda_available": cuda_available,
        "cuda_device": cuda_device,
        "streaming": True,
        "sample_rate": SAMPLE_RATE,
        "speculative_cache_size": len(speculative_cache)
    }

@app.get("/voices")
async def list_voices():
    """List available voices"""
    return {
        "voices": list(voice_manager.voices.keys()),
        "built_in": ["default"]
    }

@app.get("/speakers")
async def list_speakers():
    """List available speakers (alias for /voices for compatibility)"""
    return {
        "speakers": ["default"],
        "voices": list(voice_manager.voices.keys())
    }

@app.post("/voice_clone")
async def create_voice_clone(
    voice_id: str = Form(...),
    file: UploadFile = File(...),
    ref_text: str = Form("")
):
    """Create a voice clone from audio file
    
    Chatterbox uses reference audio for voice cloning.
    Upload a 3-10 second audio sample of the voice you want to clone.
    """
    try:
        # Save uploaded audio
        audio_data = await file.read()
        
        # Save to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name
        
        # Create voice clone reference
        success = voice_manager.create_voice_clone(voice_id, tmp_path)
        
        if success:
            return {"success": True, "voice_id": voice_id}
        else:
            return {"success": False, "error": "Failed to create voice clone"}
            
    except Exception as e:
        logger.error(f"Error creating voice clone: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tts")
async def tts_endpoint(request: TTSRequest):
    """Generate speech (batch mode)"""
    try:
        audio_bytes, sr = await generate_speech_batch(
            text=request.text,
            voice_clone_id=request.voice_clone_id,
            voice_name=request.voice,
            instruct=request.instruct,
            language=request.language
        )
        
        # Return as base64
        audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        return {
            "success": True,
            "audio": audio_b64,
            "sample_rate": sr,
            "format": "audio/raw"
        }
        
    except Exception as e:
        logger.error(f"TTS error: {e}")
        return {"success": False, "error": str(e)}

@app.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    """WebSocket endpoint for streaming TTS"""
    await websocket.accept()
    
    try:
        while True:
            # Receive request
            data = await websocket.receive_text()
            request_data = json.loads(data)
            
            text = request_data.get("text", "")
            voice_clone_id = request_data.get("voice_clone_id")
            voice = request_data.get("voice")
            instruct = request_data.get("instruct")
            language = request_data.get("language", "en")
            
            if not text:
                continue
            
            # Stream audio chunks
            async for audio_chunk, sr in generate_speech_streaming(
                text=text,
                voice_clone_id=voice_clone_id,
                voice_name=voice,
                instruct=instruct,
                language=language
            ):
                if audio_chunk.startswith(b"error:"):
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "data": audio_chunk.decode()
                    }))
                else:
                    audio_b64 = base64.b64encode(audio_chunk).decode('utf-8')
                    await websocket.send_text(json.dumps({
                        "type": "audio",
                        "data": audio_b64,
                        "sample_rate": sr
                    }))
            
            # Signal completion
            await websocket.send_text(json.dumps({
                "type": "done"
            }))
            
    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "data": str(e)
            }))
        except:
            pass

@app.get("/speculative")
async def get_speculative():
    """Get a random pre-generated filler phrase for instant response"""
    import random
    
    if not speculative_cache:
        return {"success": False, "error": "No speculative audio cached"}
    
    # Get a random filler phrase that's cached
    available = [p for p in SPECULATIVE_FILLERS if p in speculative_cache]
    if not available:
        return {"success": False, "error": "No filler phrases cached"}
    
    phrase = random.choice(available)
    audio_bytes, sr = speculative_cache[phrase]
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    return {
        "success": True,
        "text": phrase,
        "audio": audio_b64,
        "sample_rate": sr
    }


@app.get("/greeting")
async def get_greeting(voice_clone_id: str = None):
    """Get a pre-generated greeting for conversation mode startup
    
    Args:
        voice_clone_id: Optional voice clone ID to use for the greeting
    """
    import random
    
    # Get reference audio for voice cloning if specified
    audio_prompt_path = None
    if voice_clone_id:
        voice_info = voice_manager.get_voice(voice_clone_id)
        if voice_info:
            audio_prompt_path = voice_info['audio_path']
            logger.info(f"[GREETING] Using voice clone: {voice_clone_id}")
    
    # If using a custom voice, generate on demand (not cached)
    if audio_prompt_path:
        model = get_model()
        greeting = random.choice(CONVERSATION_GREETINGS)
        
        with torch.no_grad():
            audio_tensor = model.generate(greeting, audio_prompt_path=audio_prompt_path, temperature=0.8)
        
        if hasattr(audio_tensor, 'cpu'):
            wav = audio_tensor.cpu().numpy().flatten()
        else:
            wav = audio_tensor.flatten()
        
        # Normalize to prevent clipping
        max_val = np.max(np.abs(wav)) if len(wav) > 0 else 1.0
        if max_val > 0:
            wav = wav / max_val * 0.95
        
        wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
        audio_bytes = wav_int16.tobytes()
        
        return {
            "success": True,
            "text": greeting,
            "audio": base64.b64encode(audio_bytes).decode('utf-8'),
            "sample_rate": SAMPLE_RATE
        }
    
    # Use cached/pre-generated greetings for default voice
    if not speculative_cache:
        # Generate on demand if not cached
        model = get_model()
        greeting = random.choice(CONVERSATION_GREETINGS)
        
        with torch.no_grad():
            audio_tensor = model.generate(greeting, temperature=0.8)
        
        if hasattr(audio_tensor, 'cpu'):
            wav = audio_tensor.cpu().numpy().flatten()
        else:
            wav = audio_tensor.flatten()
        wav_int16 = (wav * 32767).astype(np.int16)
        audio_bytes = wav_int16.tobytes()
        
        return {
            "success": True,
            "text": greeting,
            "audio": base64.b64encode(audio_bytes).decode('utf-8'),
            "sample_rate": SAMPLE_RATE
        }
    
    # Get a random greeting that's cached
    available = [g for g in CONVERSATION_GREETINGS if g in speculative_cache]
    if not available:
        # Generate on demand
        model = get_model()
        greeting = random.choice(CONVERSATION_GREETINGS)
        
        with torch.no_grad():
            audio_tensor = model.generate(greeting, temperature=0.8)
        
        if hasattr(audio_tensor, 'cpu'):
            wav = audio_tensor.cpu().numpy().flatten()
        else:
            wav = audio_tensor.flatten()
        wav_int16 = (wav * 32767).astype(np.int16)
        audio_bytes = wav_int16.tobytes()
        
        return {
            "success": True,
            "text": greeting,
            "audio": base64.b64encode(audio_bytes).decode('utf-8'),
            "sample_rate": SAMPLE_RATE
        }
    
    greeting = random.choice(available)
    audio_bytes, sr = speculative_cache[greeting]
    audio_b64 = base64.b64encode(audio_bytes).decode('utf-8')
    
    return {
        "success": True,
        "text": greeting,
        "audio": audio_b64,
        "sample_rate": sr
    }


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print(f"Starting Chatterbox TTS Server on ws://{HOST}:{PORT}")
    print(f"Endpoints:")
    print(f"  - HTTP:  http://{HOST}:{PORT}/tts")
    print(f"  - WS:    ws://{HOST}:{PORT}/ws/tts")
    print(f"  - Health: http://{HOST}:{PORT}/health")
    # Use uvicorn with optimized settings
    uvicorn.run(
        app, 
        host=HOST, 
        port=PORT,
        log_level="warning",  # Reduce logging overhead
        access_log=False,  # Disable access logging for performance
    )
