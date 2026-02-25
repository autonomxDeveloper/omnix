#!/usr/bin/env python3
"""
OpenAI Compatible API Server
Provides drop-in replacement for OpenAI TTS and Chat APIs
Compatible with OpenWebUI, SillyTavern, and other clients
"""

import os
import json
import time
import uuid
import asyncio
import logging
import traceback
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

# Import our existing components
from chatterbox_tts_server import voice_manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Omnix OpenAI Compatible API",
    description="Drop-in replacement for OpenAI TTS and Chat APIs",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use the existing managers from the imported modules
tts_manager = None  # We'll use the functions directly from chatterbox_tts_server
voice_manager = voice_manager  # Use the existing voice manager

# Models available
AVAILABLE_MODELS = [
    "mistral-7b-instruct-v0.2",
    "qwen2.5-coder-7b-instruct",
    "gpt-4",
    "gpt-3.5-turbo"
]

class Voice(BaseModel):
    voice_id: str
    name: str
    category: str = "custom"
    preview_url: Optional[str] = None
    labels: Dict[str, str] = Field(default_factory=dict)

class SpeechRequest(BaseModel):
    model: str = "tts-1"
    voice: str
    input: str
    speed: float = 1.0
    response_format: str = "mp3"
    stream: bool = False

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: float = 1.0
    top_p: float = 1.0
    n: int = 1
    stream: bool = False
    max_tokens: Optional[int] = None
    stop: Optional[List[str]] = None
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0

class ChatChoice(BaseModel):
    index: int
    message: ChatMessage
    finish_reason: str

class ChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[ChatChoice]
    usage: Dict[str, int]

class ChatStreamChoice(BaseModel):
    index: int
    delta: Dict[str, str]
    finish_reason: Optional[str] = None

class ChatStreamResponse(BaseModel):
    id: str
    object: str = "chat.completion.chunk"
    created: int
    model: str
    choices: List[ChatStreamChoice]

class TranscriptionRequest(BaseModel):
    file: Any
    model: str = "whisper-1"
    language: Optional[str] = None
    prompt: Optional[str] = None
    response_format: str = "json"
    temperature: float = 0.0

class TranscriptionResponse(BaseModel):
    text: str

# Load available voices
def load_voices():
    """Load available voices from the voice manager"""
    voices = []
    try:
        # Get voices from our voice manager
        voice_files = voice_manager.get_available_voices()
        
        for voice_file in voice_files:
            voice_id = Path(voice_file).stem
            voice_name = voice_id.replace('_', ' ').title()
            
            # Try to load voice profile for additional info
            profile = voice_manager.load_voice_profile(voice_id)
            if profile:
                voice_name = profile.get('name', voice_name)
            
            voices.append(Voice(
                voice_id=voice_id,
                name=voice_name,
                category="custom",
                preview_url=f"/api/v1/audio/voices/{voice_id}/preview"
            ))
        
        # Add some standard voices for compatibility
        standard_voices = [
            Voice(voice_id="alloy", name="Alloy", category="alloy"),
            Voice(voice_id="echo", name="Echo", category="echo"),
            Voice(voice_id="fable", name="Fable", category="fable"),
            Voice(voice_id="onyx", name="Onyx", category="onyx"),
            Voice(voice_id="nova", name="Nova", category="nova"),
            Voice(voice_id="shimmer", name="Shimmer", category="shimmer"),
        ]
        
        voices.extend(standard_voices)
        
    except Exception as e:
        logger.error(f"Error loading voices: {e}")
        # Return some default voices
        voices = [
            Voice(voice_id="alloy", name="Alloy", category="alloy"),
            Voice(voice_id="echo", name="Echo", category="echo"),
        ]
    
    return voices

AVAILABLE_VOICES = load_voices()

@app.get("/v1/models")
async def list_models():
    """List available models"""
    return {
        "object": "list",
        "data": [
            {
                "id": model,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "omnix"
            }
            for model in AVAILABLE_MODELS
        ]
    }

@app.get("/v1/audio/voices")
async def list_voices():
    """List available voices"""
    return {
        "voices": [voice.dict() for voice in AVAILABLE_VOICES]
    }

@app.get("/v1/audio/voices/{voice_id}")
async def get_voice(voice_id: str):
    """Get voice details"""
    voice = next((v for v in AVAILABLE_VOICES if v.voice_id == voice_id), None)
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")
    return voice.dict()

@app.get("/v1/audio/voices/{voice_id}/preview")
async def get_voice_preview(voice_id: str):
    """Get voice preview audio"""
    # For custom voices, we could generate a preview
    # For now, return a placeholder
    return {"message": f"Preview for voice {voice_id}"}

@app.post("/v1/audio/speech")
async def create_speech(request: SpeechRequest, background_tasks: BackgroundTasks):
    """Generate speech from text"""
    try:
        # Generate unique ID for this request
        speech_id = str(uuid.uuid4())
        
        # Determine voice file path
        voice_file = None
        if request.voice in [v.voice_id for v in AVAILABLE_VOICES]:
            # Custom voice
            voice_file = voice_manager.get_voice_file(request.voice)
        else:
            # Use default voice or first available
            available_files = voice_manager.get_available_voices()
            if available_files:
                voice_file = available_files[0]
        
        if not voice_file:
            raise HTTPException(status_code=400, detail="No voice available")
        
        # Generate speech
        output_path = f"audio/tts_{speech_id}.{request.response_format}"
        
        # Use our TTS functions directly from chatterbox_tts_server
        # Import the generate_speech function
        from chatterbox_tts_server import generate_speech
        
        # Generate speech using the existing function
        audio_generator = generate_speech(
            text=request.input,
            voice_clone_id=request.voice if request.voice in [v.voice_id for v in AVAILABLE_VOICES] else None,
            stream=False
        )
        
        # Get the audio tensor
        audio_tensor = next(audio_generator)
        
        # Convert to numpy and save
        if hasattr(audio_tensor, 'cpu'):
            wav = audio_tensor.cpu().numpy().flatten()
        else:
            wav = audio_tensor.flatten()
        
        # Convert to int16 PCM
        wav_int16 = (wav * 32767).astype(np.int16)
        
        # Save to file
        import scipy.io.wavfile
        scipy.io.wavfile.write(output_path, 24000, wav_int16)
        
        success = True
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to generate speech")
        
        # Return the audio file
        def iterfile():
            with open(output_path, 'rb') as f:
                yield from f
        
        content_type = f"audio/{request.response_format}"
        return StreamingResponse(iterfile(), media_type=content_type)
        
    except Exception as e:
        logger.error(f"Error generating speech: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/audio/transcriptions")
async def create_transcription(request: TranscriptionRequest):
    """Transcribe audio to text"""
    try:
        # For now, we'll use a simple approach
        # In a real implementation, you'd process the uploaded file
        return TranscriptionResponse(text="This is a transcription placeholder")
        
    except Exception as e:
        logger.error(f"Error transcribing audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/chat/completions")
async def create_chat_completion(request: ChatRequest):
    """Create chat completion"""
    try:
        # Generate unique ID
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        created_time = int(time.time())
        
        # For streaming responses
        if request.stream:
            return StreamingResponse(
                generate_chat_stream(request, completion_id, created_time),
                media_type="text/event-stream"
            )
        
        # For non-streaming responses
        messages = [msg.dict() for msg in request.messages]
        
        # Here you would integrate with your LLM server
        # For now, return a placeholder response
        response_text = "This is a placeholder response from the local LLM."
        
        choice = ChatChoice(
            index=0,
            message=ChatMessage(role="assistant", content=response_text),
            finish_reason="stop"
        )
        
        response = ChatResponse(
            id=completion_id,
            created=created_time,
            model=request.model,
            choices=[choice],
            usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        )
        
        return response
        
    except Exception as e:
        logger.error(f"Error creating chat completion: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))

async def generate_chat_stream(request: ChatRequest, completion_id: str, created_time: int):
    """Generate streaming chat completion"""
    try:
        # Placeholder for streaming implementation
        # In a real implementation, you'd stream responses from your LLM
        response_text = "This is a streaming response from the local LLM."
        
        for i, char in enumerate(response_text):
            chunk = ChatStreamResponse(
                id=completion_id,
                created=created_time,
                model=request.model,
                choices=[ChatStreamChoice(
                    index=0,
                    delta={"content": char} if i < len(response_text) - 1 else {"content": char},
                    finish_reason=None if i < len(response_text) - 1 else "stop"
                )]
            )
            
            yield f"data: {chunk.json()}\n\n"
            await asyncio.sleep(0.01)  # Small delay for streaming effect
        
        # Final chunk
        yield "data: [DONE]\n\n"
        
    except Exception as e:
        logger.error(f"Error generating chat stream: {e}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "tts_available": True,  # TTS is available via chatterbox_tts_server
        "stt_available": False,  # STT not integrated in this API
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    # Start the OpenAI-compatible API server
    uvicorn.run(
        "openai_api:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info"
    )