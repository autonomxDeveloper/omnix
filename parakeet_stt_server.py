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
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
import uvicorn

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
        audio = AudioSegment.from_file(audio_path)
        duration_sec = audio.duration_seconds
        
        resampled = False
        mono = False
        
        # Resample to 16kHz if needed
        target_sr = 16000
        if audio.frame_rate != target_sr:
            audio = audio.set_frame_rate(target_sr)
            resampled = True
            
        # Convert to mono if needed
        if audio.channels == 2:
            audio = audio.set_channels(1)
            mono = True
        elif audio.channels > 2:
            raise ValueError(f"Audio has {audio.channels} channels. Only mono (1) or stereo (2) supported.")
            
        # Export processed audio if changes were made
        if resampled or mono:
            audio_name = Path(audio_path).stem
            processed_audio_path = session_dir / f"{audio_name}_processed.wav"
            audio.export(processed_audio_path, format="wav")
            return processed_audio_path.as_posix(), duration_sec
        else:
            return audio_path, duration_sec
            
    except Exception as e:
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
            
            # Perform transcription
            model.to(torch.bfloat16)
            output = model.transcribe([transcribe_path], timestamps=True)
            
            if not output or not isinstance(output, list) or not output[0] or \
               not hasattr(output[0], 'timestamp') or not output[0].timestamp or \
               'segment' not in output[0].timestamp:
                return TranscriptionResponse(
                    success=False,
                    message="Transcription failed or produced unexpected output format"
                )
            
            segment_timestamps = output[0].timestamp['segment']
            
            # Convert to response format
            segments = [
                TranscriptionSegment(
                    start=ts['start'],
                    end=ts['end'],
                    text=ts['segment']
                )
                for ts in segment_timestamps
            ]
            
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
    # Validate file type
    allowed_types = ["audio/wav", "audio/mpeg", "audio/flac", "audio/ogg", "audio/mp4", "audio/webm"]
    if file.content_type not in allowed_types:
        # Allow webm and try to process anyway
        if not file.content_type or 'webm' in file.content_type.lower():
            pass  # Accept webm
        else:
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
        file_path = session_dir / file.filename
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # Perform transcription
        result = get_transcripts_and_raw_times(file_path.as_posix(), session_dir)
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

if __name__ == "__main__":
    print("Starting Parakeet STT Server on http://0.0.0.0:8000")
    print(f"Endpoints:")
    print(f"  - Health:    http://0.0.0.0:8000/health")
    print(f"  - Transcribe: http://0.0.0.0:8000/transcribe (POST)")
    uvicorn.run(app, host="0.0.0.0", port=8000)