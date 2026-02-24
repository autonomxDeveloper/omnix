"""
Chatterbox TTS Server with WebSocket Streaming Support

Chatterbox is a fast, open-source TTS model by Resemble AI.
- Chatterbox TURBO for real-time conversational AI (~200ms latency)
- Zero-shot voice cloning from reference audio
- English-focused with natural prosody

Improvements:
- Sentence-aware text chunking for natural prosody
- Server-side resampling to 48kHz (high quality)
- Optional DeepFilterNet2 speech enhancement
- Web Audio API compatible output

Requirements:
    pip install chatterbox-tts torch torchaudio
    pip install scipy  # For high-quality resampling
    pip install df-algo  # Optional: DeepFilterNet2 for speech enhancement

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
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator, Optional, List, Tuple

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
SAMPLE_RATE = 24000  # Chatterbox native sample rate
OUTPUT_SAMPLE_RATE = 48000  # Output at 48kHz for better browser compatibility
CHUNK_SIZE = 4096  # Smaller chunks for lower latency

# Feature flags
ENABLE_ENHANCEMENT = os.environ.get("ENABLE_ENHANCEMENT", "false").lower() == "true"
ENABLE_48KHZ = os.environ.get("ENABLE_48KHZ", "true").lower() == "true"

# Crossfade settings
CROSSFADE_SAMPLES = 480  # ~10ms at 48kHz for smooth transitions

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
# AUDIO PROCESSING UTILITIES
# ============================================================

# Try to import scipy for high-quality resampling
_resampler = None

def get_resampler():
    """Get or create a high-quality resampler
    
    Priority: torchaudio (best) > scipy (good) > numpy (basic)
    """
    global _resampler
    if _resampler is not None:
        return _resampler
    
    # Try torchaudio first - highest quality (sinc interpolation)
    try:
        import torchaudio.transforms as T
        _resampler = "torchaudio"
        logger.info("[AUDIO] Using torchaudio for high-quality resampling (sinc interpolation)")
        return _resampler
    except ImportError:
        pass
    
    # Try scipy - good quality (FFT-based)
    try:
        import scipy.signal
        _resampler = "scipy"
        logger.info("[AUDIO] Using scipy for resampling (FFT-based)")
        return _resampler
    except ImportError:
        pass
    
    # Fallback to numpy - basic quality (linear interpolation)
    _resampler = "numpy"
    logger.info("[AUDIO] Using numpy for basic resampling (install torchaudio for best quality)")
    return _resampler


def resample_audio(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    """High-quality audio resampling
    
    Args:
        audio: Audio samples as numpy array (float32 or int16)
        orig_sr: Original sample rate
        target_sr: Target sample rate
    
    Returns:
        Resampled audio as numpy array (float32)
    """
    if orig_sr == target_sr:
        return audio.astype(np.float32) if audio.dtype != np.float32 else audio
    
    # Convert to float32 if needed
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    
    resampler_type = get_resampler()
    
    if resampler_type == "torchaudio":
        import torch
        import torchaudio.transforms as T
        
        # Convert to tensor [1, samples]
        audio_tensor = torch.from_numpy(audio).unsqueeze(0).float()
        
        # Create high-quality resampler (sinc interpolation)
        resampler = T.Resample(orig_sr, target_sr, dtype=torch.float32)
        
        # Resample
        resampled = resampler(audio_tensor).squeeze(0).numpy()
        return resampled.astype(np.float32)
    
    elif resampler_type == "scipy":
        import scipy.signal
        # Calculate number of samples in output
        num_samples = int(len(audio) * target_sr / orig_sr)
        # Use scipy's FFT-based resampling
        resampled = scipy.signal.resample(audio, num_samples)
        return resampled.astype(np.float32)
    
    else:
        # Fallback: linear interpolation (basic but works)
        ratio = target_sr / orig_sr
        num_samples = int(len(audio) * ratio)
        indices = np.arange(num_samples) / ratio
        indices = np.clip(indices, 0, len(audio) - 1)
        
        # Linear interpolation
        resampled = np.interp(indices, np.arange(len(audio)), audio)
        return resampled.astype(np.float32)


def pcm16_to_float32(pcm16: np.ndarray) -> np.ndarray:
    """Convert 16-bit PCM to Float32 for clean pipeline
    
    Args:
        pcm16: Int16 PCM audio data
        
    Returns:
        Float32 audio data in range [-1, 1]
    """
    return pcm16.astype(np.float32) / 32768.0


def float32_to_pcm16(float32: np.ndarray) -> np.ndarray:
    """Convert Float32 to 16-bit PCM for output
    
    Args:
        float32: Float32 audio data in range [-1, 1]
        
    Returns:
        Int16 PCM audio data
    """
    # Clamp to valid range and convert
    clamped = np.clip(float32, -1.0, 1.0)
    return (clamped * 32767).astype(np.int16)


# DeepFilterNet2 integration (optional)
_df_model = None
_df_state = None

def get_deepfilter():
    """Load DeepFilterNet model for speech enhancement"""
    global _df_model, _df_state
    
    if _df_model is not None:
        return _df_model, _df_state
    
    if not ENABLE_ENHANCEMENT:
        return None, None
    
    try:
        # Try the new deepfilternet package API
        from df import init_df
        _df_model, _df_state, _ = init_df()
        logger.info("[DEEPFILTER] DeepFilterNet loaded successfully")
        return _df_model, _df_state
    except ImportError:
        try:
            # Try alternative import
            from deepfilternet import DeepFilter
            _df_model = DeepFilter()
            _df_state = None
            logger.info("[DEEPFILTER] DeepFilterNet loaded (alternative API)")
            return _df_model, _df_state
        except ImportError:
            logger.warning("[DEEPFILTER] DeepFilterNet not installed. Install with: pip install deepfilternet")
            return None, None
    except Exception as e:
        logger.warning(f"[DEEPFILTER] Could not load DeepFilterNet: {e}")
        return None, None


def enhance_audio(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    """Apply DeepFilterNet speech enhancement
    
    Removes metallic artifacts, smooths high-frequency noise,
    and makes voice sound more "studio quality".
    """
    model, state = get_deepfilter()
    
    if model is None:
        return audio
    
    try:
        import torch
        
        # Convert to tensor [1, samples]
        audio_tensor = torch.from_numpy(audio).float()
        if len(audio_tensor.shape) == 1:
            audio_tensor = audio_tensor.unsqueeze(0)
        
        # DeepFilterNet expects 48kHz, resample if needed
        if sample_rate != 48000:
            audio_tensor_48k = torch.from_numpy(
                resample_audio(audio, sample_rate, 48000)
            ).float().unsqueeze(0)
        else:
            audio_tensor_48k = audio_tensor
        
        # Enhance using df API
        with torch.no_grad():
            if state is not None:
                # Use the state-based API
                from df.enhance import enhance
                enhanced = enhance(model, audio_tensor_48k, state)
            else:
                # Use model directly
                enhanced = model(audio_tensor_48k)
        
        # Resample back if needed
        if sample_rate != 48000:
            enhanced_np = enhanced.squeeze(0).numpy().astype(np.float32)
            enhanced = resample_audio(enhanced_np, 48000, sample_rate)
        else:
            enhanced = enhanced.squeeze(0).numpy().astype(np.float32)
        
        return enhanced
    
    except Exception as e:
        logger.warning(f"[DEEPFILTER] Enhancement failed: {e}")
        return audio


# ============================================================
# SMART TEXT CHUNKING (LINGUISTIC BOUNDARIES)
# ============================================================

def remove_dc_offset(audio_chunk: np.ndarray) -> np.ndarray:
    """Remove DC offset from audio chunk to prevent clicks
    
    DC offset (non-zero mean) causes clicks when chunks are concatenated.
    This removes the mean from each chunk for clean transitions.
    """
    if len(audio_chunk) == 0:
        return audio_chunk
    return audio_chunk - np.mean(audio_chunk)


class TextChunker:
    """Smart text chunker that splits on linguistic boundaries for natural prosody"""
    
    # Primary sentence boundaries
    SENTENCE_END = re.compile(r'(?<=[.!?])\s+')
    
    # Secondary boundaries (clauses, phrases)
    CLAUSE_BOUNDARIES = re.compile(r'(?<=[,;:])\s+')
    
    # Conjunction boundaries (and, but, or, etc.)
    CONJUNCTION_BOUNDARIES = re.compile(r'\s+(?=and|but|or|so|yet|for|nor)\s+', re.IGNORECASE)
    
    # Minimum chunk size (in characters) - larger for smoother prosody
    MIN_CHUNK_SIZE = 60
    
    # Maximum chunk size - allow longer chunks for natural sentence flow
    MAX_CHUNK_SIZE = 250
    
    @classmethod
    def chunk_for_streaming(cls, text: str) -> List[str]:
        """Split text into chunks optimized for TTS streaming
        
        Priority:
        1. Sentence boundaries (periods, !, ?)
        2. Clause boundaries (commas, semicolons, colons)
        3. Conjunction boundaries (and, but, or)
        4. Force split if too long
        
        Returns:
            List of text chunks that preserve natural prosody
        """
        chunks = []
        
        # First, split by sentences (highest priority)
        sentences = cls.SENTENCE_END.split(text)
        
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            
            # If sentence is short enough, use as-is
            if len(sentence) <= cls.MAX_CHUNK_SIZE:
                chunks.append(sentence)
                continue
            
            # Sentence is too long, split by clauses
            clause_parts = cls.CLAUSE_BOUNDARIES.split(sentence)
            
            current_chunk = ""
            for part in clause_parts:
                part = part.strip()
                if not part:
                    continue
                
                # Check if adding this part would exceed max size
                if current_chunk and len(current_chunk) + len(part) + 2 > cls.MAX_CHUNK_SIZE:
                    # Current chunk is ready
                    if len(current_chunk) >= cls.MIN_CHUNK_SIZE:
                        chunks.append(current_chunk.strip())
                        current_chunk = part
                    else:
                        # Too short, merge with part
                        current_chunk += ", " + part
                else:
                    if current_chunk:
                        current_chunk += ", " + part
                    else:
                        current_chunk = part
            
            if current_chunk:
                chunks.append(current_chunk.strip())
        
        # Final pass: ensure no chunk is too short (merge tiny chunks)
        final_chunks = []
        for chunk in chunks:
            if final_chunks and len(chunk) < cls.MIN_CHUNK_SIZE:
                # Merge with previous chunk
                final_chunks[-1] += " " + chunk
            else:
                final_chunks.append(chunk)
        
        return final_chunks


def split_text_into_sentences(text):
    """Split text into sentences for streaming TTS (legacy compatibility)"""
    return TextChunker.chunk_for_streaming(text)

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
    """Generate speech with TRUE streaming - each sentence is sent immediately after generation
    
    This provides the lowest possible latency for TTS streaming.
    Each sentence is:
    1. Generated
    2. Processed (normalized, filtered)
    3. Resampled to 48kHz (if enabled)
    4. Sent immediately to client
    
    The client receives audio as it's being generated, not after all text is processed.
    """
    
    try:
        model = get_model()
        
        # Get reference audio for voice cloning if specified
        audio_prompt_path = None
        if voice_clone_id:
            voice_info = voice_manager.get_voice(voice_clone_id)
            if voice_info:
                audio_prompt_path = voice_info['audio_path']
        
        # Split text into chunks using smart chunker
        chunks = TextChunker.chunk_for_streaming(text)
        
        if not chunks:
            chunks = [text]  # Fallback if no boundaries found
        
        logger.info(f"[STREAM] Streaming {len(chunks)} chunks...")
        
        # Track previous chunk's end for crossfade continuity
        previous_end_samples = None
        
        # Process each chunk and stream immediately
        for i, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue
            
            chunk_start = time.time()
            logger.info(f"[STREAM] Generating chunk {i+1}/{len(chunks)}: '{chunk_text[:40]}...'")
            
            # Generate audio for this chunk
            with torch.no_grad():
                audio_tensor = model.generate(
                    chunk_text,
                    audio_prompt_path=audio_prompt_path,
                    temperature=0.8
                )
            
            # Convert tensor to numpy
            if hasattr(audio_tensor, 'cpu'):
                wav = audio_tensor.cpu().numpy().flatten().astype(np.float32)
            else:
                wav = audio_tensor.flatten().astype(np.float32)
            
            gen_time = (time.time() - chunk_start) * 1000
            
            # Apply DC offset removal (high-pass filter)
            if len(wav) > 100:
                window_size = 100
                moving_avg = np.convolve(wav, np.ones(window_size)/window_size, mode='same')
                wav = wav - moving_avg
            
            # RMS normalization for consistent volume
            if len(wav) > 0:
                rms = np.sqrt(np.mean(wav ** 2))
                if rms > 0:
                    target_rms = 0.08  # Slightly lower for streaming to leave headroom
                    wav = wav * (target_rms / rms)
                
                # Soft limiting
                max_val = np.max(np.abs(wav))
                if max_val > 0.9:
                    wav = np.tanh(wav * 0.85)
            
            # Apply optional speech enhancement
            if ENABLE_ENHANCEMENT:
                wav = enhance_audio(wav, SAMPLE_RATE)
            
            # Resample to 48kHz if enabled
            output_sr = SAMPLE_RATE
            if ENABLE_48KHZ:
                wav = resample_audio(wav, SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
                output_sr = OUTPUT_SAMPLE_RATE
            
            # Convert to int16 PCM
            wav_int16 = np.clip(wav * 32767, -32768, 32767).astype(np.int16)
            
            # Yield this chunk immediately (true streaming!)
            process_time = (time.time() - chunk_start) * 1000
            logger.info(f"[STREAM] Chunk {i+1} ready: gen={gen_time:.0f}ms, total={process_time:.0f}ms, samples={len(wav_int16)}")
            
            # Send the entire chunk at once (reduced overhead)
            yield (wav_int16.tobytes(), output_sr)
            
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
        
        # Apply gentle high-pass filter FIRST to remove DC offset
        # This prevents low-frequency rumble that causes artifacts
        if len(full_wav) > 100:
            window_size = 100
            moving_avg = np.convolve(full_wav, np.ones(window_size)/window_size, mode='same')
            full_wav = full_wav - moving_avg
        
        # Consistent normalization using RMS (loudness-based) for consistent volume
        # This prevents volume jumps between different chunks
        if len(full_wav) > 0:
            rms = np.sqrt(np.mean(full_wav ** 2))
            if rms > 0:
                # Target RMS of 0.1 (about -20dB) for consistent loudness
                target_rms = 0.1
                full_wav = full_wav * (target_rms / rms)
            
        # Apply soft limiting to prevent harsh clipping
            # Uses tanh for smooth saturation instead of hard clipping
            max_val = np.max(np.abs(full_wav))
            if max_val > 0.95:
                full_wav = np.tanh(full_wav * 0.9) * 0.95
        
        # Apply optional speech enhancement
        if ENABLE_ENHANCEMENT:
            full_wav = enhance_audio(full_wav.astype(np.float32), SAMPLE_RATE)
        
        # Resample to 48kHz if enabled
        output_sr = SAMPLE_RATE
        if ENABLE_48KHZ:
            full_wav = resample_audio(full_wav, SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
            output_sr = OUTPUT_SAMPLE_RATE
        
        # Convert to 16-bit PCM
        wav_int16 = np.clip(full_wav * 32767, -32768, 32767).astype(np.int16)
        return wav_int16.tobytes(), output_sr
        
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
    """WebSocket endpoint for streaming TTS with binary Float32 output
    
    Protocol:
    - Client sends: {"text": "...", "voice_clone_id": "..."} (JSON text)
    - Server sends: Binary Float32 audio chunks directly (no Base64)
    - Server sends: {"type": "done"} (JSON text) when complete
    
    Binary format: Raw Float32Array samples at 48kHz, mono
    """
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
            
            # Stream audio chunks as binary Float32
            async for audio_chunk, sr in generate_speech_streaming_float32(
                text=text,
                voice_clone_id=voice_clone_id,
                voice_name=voice,
                instruct=instruct,
                language=language
            ):
                if isinstance(audio_chunk, bytes) and audio_chunk.startswith(b"error:"):
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "data": audio_chunk.decode()
                    }))
                else:
                    # Send raw Float32 binary directly (no Base64 encoding)
                    # Client receives as ArrayBuffer -> Float32Array
                    await websocket.send_bytes(audio_chunk)
            
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


async def generate_speech_streaming_float32(
    text: str,
    voice_clone_id: str = None,
    voice_name: str = None,
    instruct: str = None,
    language: str = "en"
) -> AsyncIterator[tuple[bytes, int]]:
    """Generate speech with TRUE streaming - Float32 binary output
    
    Output: Raw Float32Array bytes (no Base64, no Int16 conversion)
    Sample rate: 48kHz for Web Audio API compatibility
    """
    
    try:
        model = get_model()
        
        # Get reference audio for voice cloning if specified
        audio_prompt_path = None
        if voice_clone_id:
            voice_info = voice_manager.get_voice(voice_clone_id)
            if voice_info:
                audio_prompt_path = voice_info['audio_path']
        
        # Split text into chunks using smart chunker
        chunks = TextChunker.chunk_for_streaming(text)
        
        if not chunks:
            chunks = [text]  # Fallback if no boundaries found
        
        logger.info(f"[STREAM-F32] Streaming {len(chunks)} chunks as Float32...")
        
        # Process each chunk and stream immediately
        for i, chunk_text in enumerate(chunks):
            if not chunk_text.strip():
                continue
            
            chunk_start = time.time()
            logger.info(f"[STREAM-F32] Generating chunk {i+1}/{len(chunks)}: '{chunk_text[:40]}...'")
            
            # Generate audio for this chunk
            with torch.no_grad():
                audio_tensor = model.generate(
                    chunk_text,
                    audio_prompt_path=audio_prompt_path,
                    temperature=0.8
                )
            
            # Convert tensor to numpy Float32
            if hasattr(audio_tensor, 'cpu'):
                wav = audio_tensor.cpu().numpy().flatten().astype(np.float32)
            else:
                wav = audio_tensor.flatten().astype(np.float32)
            
            gen_time = (time.time() - chunk_start) * 1000
            
            # Remove DC offset (prevents clicks)
            wav = remove_dc_offset(wav)
            
            # RMS normalization for consistent volume
            if len(wav) > 0:
                rms = np.sqrt(np.mean(wav ** 2))
                if rms > 0:
                    target_rms = 0.08
                    wav = wav * (target_rms / rms)
                
                # Soft limiting
                max_val = np.max(np.abs(wav))
                if max_val > 0.9:
                    wav = np.tanh(wav * 0.85)
            
            # Resample to 48kHz if enabled (Float32 throughout)
            output_sr = SAMPLE_RATE
            if ENABLE_48KHZ:
                wav = resample_audio(wav, SAMPLE_RATE, OUTPUT_SAMPLE_RATE)
                output_sr = OUTPUT_SAMPLE_RATE
            
            # Convert to raw Float32 bytes (no Int16 conversion!)
            float32_bytes = wav.tobytes()
            
            # Yield binary Float32 chunk
            process_time = (time.time() - chunk_start) * 1000
            logger.info(f"[STREAM-F32] Chunk {i+1} ready: gen={gen_time:.0f}ms, total={process_time:.0f}ms, samples={len(wav)}, bytes={len(float32_bytes)}")
            
            yield (float32_bytes, output_sr)
            
    except Exception as e:
        logger.error(f"Error in Float32 streaming generation: {e}")
        import traceback
        logger.error(traceback.format_exc())
        yield (f"error:{str(e)}".encode(), 0)

@app.post("/test_wav")
async def test_tts_to_wav(text: str = "This is a test of the text to speech system. We are recording a thirty second sample to check for any audio artifacts or quality issues in the output. The quick brown fox jumps over the lazy dog multiple times while the sun sets in the distance. Testing one two three four five six seven eight nine ten. This sentence is longer to provide more audio data for analysis purposes. Thank you for testing the audio quality of this TTS system."):
    """Generate TTS and save directly to WAV file for quality testing
    
    This bypasses all streaming/Base64/browser code to test raw TTS output.
    Use to determine if artifacts are from:
    - Turbo model (if WAV has artifacts)
    - Streaming pipeline (if WAV is clean)
    
    Output: test_output.wav in the server directory
    """
    import wave
    import struct
    
    try:
        logger.info(f"[TEST] Generating test WAV for: '{text[:50]}...'")
        start_time = time.time()
        
        # Generate audio
        audio_bytes, sr = await generate_speech_batch(text=text)
        
        gen_time = (time.time() - start_time) * 1000
        logger.info(f"[TEST] Generated {len(audio_bytes)} bytes at {sr}Hz in {gen_time:.0f}ms")
        
        # Save as WAV file
        output_path = Path(__file__).parent / "test_output.wav"
        
        with wave.open(str(output_path), 'wb') as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sr)
            wav_file.writeframes(audio_bytes)
        
        file_size = output_path.stat().st_size
        duration_sec = len(audio_bytes) / (sr * 2)  # 2 bytes per sample
        
        logger.info(f"[TEST] Saved to {output_path} ({file_size} bytes, {duration_sec:.1f}s)")
        
        return {
            "success": True,
            "file": str(output_path),
            "sample_rate": sr,
            "duration_seconds": duration_sec,
            "generation_time_ms": gen_time,
            "file_size_bytes": file_size
        }
        
    except Exception as e:
        logger.error(f"[TEST] Error: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {"success": False, "error": str(e)}


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
    print(f"\nFeature Flags:")
    print(f"  - ENABLE_ENHANCEMENT (DeepFilterNet): {ENABLE_ENHANCEMENT}")
    print(f"  - ENABLE_48KHZ (48kHz output): {ENABLE_48KHZ}")
    if not ENABLE_ENHANCEMENT:
        print(f"\n  TIP: Set ENABLE_ENHANCEMENT=true env var to enable speech enhancement")
    # Use uvicorn with optimized settings
    uvicorn.run(
        app, 
        host=HOST, 
        port=PORT,
        log_level="warning",  # Reduce logging overhead
        access_log=False,  # Disable access logging for performance
    )
