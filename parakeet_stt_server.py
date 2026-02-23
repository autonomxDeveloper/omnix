"""
Parakeet TDT 0.6B STT Server
FastAPI server for speech-to-text using NVIDIA NeMo Parakeet model

This file is placed in the root to avoid import conflicts with the 
local nemo folder in models/stt/parakeet-tdt-0.6b-v2/
"""
from nemo.collections.asr.models import ASRModel
import torch
import gc
import shutil
from pathlib import Path
from pydub import AudioSegment
import numpy as np
import datetime
import tempfile
import uuid
from typing import List, Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
import uvicorn
import asyncio
import base64

# Configuration
device = "cuda" if torch.cuda.is_available() else "cpu"
MODEL_NAME = "nvidia/parakeet-tdt-0.6b-v2"

# Global model instance
model = None

def load_model():
    """Load the ASR model on startup"""
    global model
    try:
        model = ASRModel.from_pretrained(model_name=MODEL_NAME)
        model.eval()
        print(f"Model {MODEL_NAME} loaded successfully on {device}")
    except Exception as e:
        print(f"Failed to load model: {e}")
        model = None

# Pydantic models for API
class TranscriptionSegment(BaseModel):
    start: float = Field(..., description="Start time in seconds")
    end: float = Field(..., description="End time in seconds") 
    text: str = Field(..., description="Transcribed text segment")

class TranscriptionResponse(BaseModel):
    success: bool = Field(..., description="Whether transcription was successful")
    segments: List[TranscriptionSegment] = Field(default=[], description="List of transcription segments")
    duration: Optional[float] = Field(None, description="Total audio duration in seconds")
    message: Optional[str] = Field(None, description="Status message or error description")

class HealthResponse(BaseModel):
    status: str = Field(..., description="Service health status")
    model_loaded: bool = Field(..., description="Whether the ASR model is loaded")
    device: str = Field(..., description="Device being used (cuda/cpu)")

# Initialize FastAPI app
app = FastAPI(
    title="Speech Transcription API",
    description="A REST API for speech-to-text transcription using NVIDIA's parakeet-tdt-0.6b-v2 model",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Add CORS middleware to allow cross-origin requests from the main app
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cleanup_session_dir(session_dir: Path):
    """Background task to clean up session directory"""
    try:
        if session_dir.exists():
            shutil.rmtree(session_dir)
            print(f"Cleaned up session directory: {session_dir}")
    except Exception as e:
        print(f"Error cleaning up session directory {session_dir}: {e}")

def process_audio_for_transcription(audio_path: str, session_dir: Path) -> tuple:
    """Process audio file for transcription (resampling, mono conversion)"""
    try:
        print(f"[STT] Loading audio from: {audio_path}")
        audio = AudioSegment.from_file(audio_path)
        duration_sec = audio.duration_seconds
        
        print(f"[STT] Audio loaded: duration={duration_sec:.2f}s, channels={audio.channels}, frame_rate={audio.frame_rate}")
        
        resampled = False
        mono = False
        
        # Resample to 16kHz if needed
        target_sr = 16000
        if audio.frame_rate != target_sr:
            print(f"[STT] Resampling from {audio.frame_rate}Hz to {target_sr}Hz")
            audio = audio.set_frame_rate(target_sr)
            resampled = True
            
        # Convert to mono if needed
        if audio.channels == 2:
            print(f"[STT] Converting stereo to mono")
            audio = audio.set_channels(1)
            mono = True
        elif audio.channels > 2:
            raise ValueError(f"Audio has {audio.channels} channels. Only mono (1) or stereo (2) supported.")
            
        # Export processed audio if changes were made
        if resampled or mono:
            audio_name = Path(audio_path).stem
            processed_audio_path = session_dir / f"{audio_name}_processed.wav"
            print(f"[STT] Exporting processed audio to: {processed_audio_path}")
            audio.export(processed_audio_path, format="wav")
            print(f"[STT] Export complete, file size: {processed_audio_path.stat().st_size} bytes")
            return processed_audio_path.as_posix(), duration_sec
        else:
            print(f"[STT] No processing needed, using original file")
            return audio_path, duration_sec
            
    except Exception as e:
        print(f"[STT] Error processing audio: {e}")
        import traceback
        traceback.print_exc()
        raise RuntimeError(f"Failed to process audio: {e}")

def get_transcripts_and_raw_times(audio_path: str, session_dir: Path) -> TranscriptionResponse:
    """Main transcription function"""
    if not model:
        return TranscriptionResponse(
            success=False,
            message="ASR model is not loaded"
        )
    
    if not audio_path:
        return TranscriptionResponse(
            success=False,
            message="No audio file path provided"
        )
    
    try:
        # Process audio
        transcribe_path, duration_sec = process_audio_for_transcription(audio_path, session_dir)
        
        # Configure model for long audio if needed
        long_audio_settings_applied = False
        try:
            model.to(device)
            model.to(torch.float32)
            
            # Apply settings for long audio (>8 minutes)
            if duration_sec > 480:
                print("Applying long audio settings: Local Attention and Chunking.")
                model.change_attention_model("rel_pos_local_attn", [256, 256])
                model.change_subsampling_conv_chunking_factor(1)
                long_audio_settings_applied = True
            
            # Perform transcription (simple approach without timestamps first)
            model.to(torch.bfloat16)
            
            # Try simple transcription first (like the original app.py)
            try:
                output = model.transcribe([transcribe_path])
            except Exception as trans_err:
                print(f"[STT] Simple transcription failed, trying with timestamps: {trans_err}")
                output = model.transcribe([transcribe_path], timestamps=True)
            
            print(f"[STT] Transcription output type: {type(output)}")
            print(f"[STT] Output length: {len(output) if output else 0}")
            
            if not output or not isinstance(output, list) or not output[0]:
                print(f"[STT] No transcription output")
                return TranscriptionResponse(
                    success=False,
                    message="Transcription produced no output"
                )
            
            # Check the output structure
            result = output[0]
            print(f"[STT] Result type: {type(result)}")
            
            # Extract text - handle different output formats
            transcribed_text = ""
            
            if isinstance(result, str):
                transcribed_text = result
                print(f"[STT] Result is string: {transcribed_text[:100] if transcribed_text else 'empty'}...")
            elif hasattr(result, 'text'):
                transcribed_text = result.text
                print(f"[STT] Result has .text: {transcribed_text[:100] if transcribed_text else 'empty'}...")
            else:
                # Try to convert to string
                transcribed_text = str(result)
                print(f"[STT] Result converted to string: {transcribed_text[:100] if transcribed_text else 'empty'}...")
            
            transcribed_text = transcribed_text.strip()
            
            if not transcribed_text:
                print(f"[STT] Empty transcription result")
                return TranscriptionResponse(
                    success=False,
                    message="No speech detected in audio"
                )
            
            # Create a single segment with the full text
            segments = [TranscriptionSegment(
                start=0.0,
                end=duration_sec,
                text=transcribed_text
            )]
            
            print(f"[STT] Transcribed text: {transcribed_text}")
            
            return TranscriptionResponse(
                success=True,
                segments=segments,
                duration=duration_sec,
                message="Transcription completed successfully"
            )
            
        finally:
            # Revert model settings if applied
            if long_audio_settings_applied:
                try:
                    print("Reverting long audio settings.")
                    model.change_attention_model("rel_pos")
                    model.change_subsampling_conv_chunking_factor(-1)
                except Exception as e:
                    print(f"Warning: Failed to revert long audio settings: {e}")
            
            # Cleanup
            try:
                if device == 'cuda':
                    model.cpu()
                gc.collect()
                if device == 'cuda':
                    torch.cuda.empty_cache()
            except Exception as e:
                print(f"Error during model cleanup: {e}")
                
    except torch.cuda.OutOfMemoryError as e:
        return TranscriptionResponse(
            success=False,
            message="CUDA out of memory. Please try a shorter audio or reduce GPU load."
        )
    except Exception as e:
        return TranscriptionResponse(
            success=False,
            message=f"Transcription failed: {str(e)}"
        )

# API Endpoints
@app.on_event("startup")
async def startup_event():
    """Load model on startup"""
    load_model()

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy" if model else "unhealthy",
        model_loaded=model is not None,
        device=device
    )

@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Audio file to transcribe")
):
    """
    Transcribe an audio file to text with timestamps
    
    - **file**: Audio file (supported formats: wav, mp3, flac, etc.)
    
    Returns transcription segments with start/end timestamps and text
    """
    print(f"[STT] Received transcription request: filename={file.filename}, content_type={file.content_type}")
    
    # Validate file type
    allowed_types = ["audio/wav", "audio/mpeg", "audio/flac", "audio/ogg", "audio/mp4", "audio/webm"]
    if file.content_type not in allowed_types:
        # Allow webm and try to process anyway
        if not file.content_type or 'webm' in file.content_type.lower():
            print(f"[STT] Accepting webm content type: {file.content_type}")
            pass  # Accept webm
        else:
            print(f"[STT] Rejecting content type: {file.content_type}")
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {file.content_type}. Allowed types: {allowed_types}"
            )
    
    # Create session directory
    session_id = str(uuid.uuid4())
    session_dir = Path(tempfile.gettempdir()) / f"transcription_{session_id}"
    session_dir.mkdir(parents=True, exist_ok=True)
    
    # Schedule cleanup
    background_tasks.add_task(cleanup_session_dir, session_dir)
    
    try:
        # Save uploaded file
        file_path = session_dir / (file.filename or "audio.webm")
        content = await file.read()
        file_size = len(content)
        print(f"[STT] Received {file_size} bytes of audio data")
        
        if file_size < 100:
            print(f"[STT] Audio file too small: {file_size} bytes")
            return TranscriptionResponse(
                success=False,
                message=f"Audio file too small ({file_size} bytes). Please record for at least 1 second."
            )
        
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        
        print(f"[STT] Saved audio to: {file_path}")
        
        # Perform transcription
        result = get_transcripts_and_raw_times(file_path.as_posix(), session_dir)
        print(f"[STT] Transcription result: success={result.success}, segments={len(result.segments) if result.segments else 0}")
        return result
        
    except Exception as e:
        print(f"[STT] Error during transcription: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# WebSocket endpoint for streaming STT
@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """
    WebSocket endpoint for streaming speech-to-text.
    
    Client sends:
    - {"type": "audio", "data": "<base64-encoded-audio-chunk>"}
    - {"type": "final"} to signal end of audio
    
    Server sends:
    - {"type": "ready"} when connection is ready
    - {"type": "text", "text": "<partial-transcript>"} during streaming
    - {"type": "done", "text": "<final-transcript>"} when complete
    - {"type": "error", "error": "<error-message>"} on error
    """
    await websocket.accept()
    
    try:
        # Signal ready
        await websocket.send_json({"type": "ready"})
        
        # Collect audio chunks
        audio_chunks = []
        
        while True:
            try:
                # Receive message
                data = await websocket.receive_json()
                msg_type = data.get("type", "")
                
                if msg_type == "audio":
                    # Decode and collect audio chunk
                    audio_b64 = data.get("data", "")
                    if audio_b64:
                        audio_chunk = base64.b64decode(audio_b64)
                        audio_chunks.append(audio_chunk)
                        
                        # For now, we don't send partial results
                        # Real streaming would require a streaming ASR model
                        
                elif msg_type == "final":
                    # Process all collected audio
                    if not audio_chunks:
                        await websocket.send_json({
                            "type": "done",
                            "text": ""
                        })
                        break
                    
                    if not model:
                        await websocket.send_json({
                            "type": "error",
                            "error": "ASR model not loaded"
                        })
                        break
                    
                    # Combine audio chunks
                    combined_audio = b"".join(audio_chunks)
                    
                    # Create temp file for transcription
                    session_id = str(uuid.uuid4())
                    session_dir = Path(tempfile.gettempdir()) / f"ws_transcription_{session_id}"
                    session_dir.mkdir(parents=True, exist_ok=True)
                    
                    try:
                        # Write audio to temp file as webm
                        webm_path = session_dir / "audio.webm"
                        with open(webm_path, "wb") as f:
                            f.write(combined_audio)
                        
                        # Convert webm to wav using pydub for proper processing
                        # MediaRecorder produces webm/opus which may need conversion
                        try:
                            audio = AudioSegment.from_file(webm_path, format="webm")
                            wav_path = session_dir / "audio.wav"
                            audio.export(wav_path, format="wav")
                            audio_path = wav_path
                        except Exception as conv_err:
                            # Try as raw webm if pydub fails
                            print(f"Webm conversion failed, trying direct: {conv_err}")
                            # Try alternative: use webm directly
                            audio_path = webm_path
                        
                        # Process and transcribe
                        result = get_transcripts_and_raw_times(str(audio_path), session_dir)
                        
                        if result.success:
                            # Combine all segment texts
                            full_text = " ".join([seg.text for seg in result.segments])
                            await websocket.send_json({
                                "type": "done",
                                "text": full_text,
                                "segments": [{"start": s.start, "end": s.end, "text": s.text} for s in result.segments]
                            })
                        else:
                            await websocket.send_json({
                                "type": "error",
                                "error": result.message or "Transcription failed"
                            })
                            
                    finally:
                        # Cleanup
                        cleanup_session_dir(session_dir)
                    
                    # Clear buffer for next utterance
                    audio_chunks = []
                    break
                    
            except Exception as e:
                import traceback
                print(f"WebSocket transcription error: {e}")
                traceback.print_exc()
                await websocket.send_json({
                    "type": "error",
                    "error": str(e)
                })
                break
                
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "error": str(e)
            })
        except:
            pass

if __name__ == "__main__":
    print("Starting Parakeet STT Server on http://0.0.0.0:8000")
    print(f"Endpoints:")
    print(f"  - Health:    http://0.0.0.0:8000/health")
    print(f"  - Transcribe: http://0.0.0.0:8000/transcribe (POST)")
    print(f"  - WebSocket:  ws://0.0.0.0:8000/ws/transcribe")
    uvicorn.run(app, host="0.0.0.0", port=8000)
