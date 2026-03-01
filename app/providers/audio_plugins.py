"""
Audio Provider Plugin Implementations

This module contains concrete implementations of audio providers:
- ChatterboxTTS: Wraps CosyVoice TTS service
- ParakeetSTT: Wraps FasterWhisper/Parakeet STT service
"""

import subprocess
import requests
import time
import os
import base64
from typing import Optional, Dict, List, Any
from pathlib import Path

from .audio_base import (
    BaseTTSProvider, BaseSTTProvider, 
    AudioProviderConfig, TTSAudioResponse, STTTranscriptionResponse,
    AudioProviderCapability
)


class ChatterboxTTS(BaseTTSProvider):
    """
    Chatterbox TTS Provider - wraps CosyVoice TTS service.
    
    Manages the CosyVoice subprocess and communicates via HTTP to localhost:8020.
    Handles voice cloning logic and provides standardized TTS interface.
    """
    
    provider_name = "chatterbox"
    
    def start(self) -> Dict[str, Any]:
        """
        Start the CosyVoice TTS subprocess.
        
        Returns:
            Dict with 'running' status and optional 'message'
        """
        if self.process and self.process.poll() is None:
            return {"running": True, "message": "Service already running"}
        
        try:
            # Start the CosyVoice TTS server
            script_path = Path(__file__).parent.parent.parent / "chatterbox_tts_server.py"
            if not script_path.exists():
                return {"running": False, "message": f"Server script not found: {script_path}"}
            
            self.process = subprocess.Popen(
                ['python', str(script_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            
            # Start log capture
            self._start_log_thread()
            
            # Wait for service to be ready
            max_wait = 30
            for _ in range(max_wait):
                if self.health_check():
                    return {"running": True, "message": "Chatterbox TTS started successfully"}
                time.sleep(1)
            
            # If we get here, service didn't start properly
            self.stop()
            return {"running": False, "message": "Service failed to start within timeout"}
            
        except Exception as e:
            return {"running": False, "message": f"Failed to start: {str(e)}"}
    
    def health_check(self) -> bool:
        """
        Check if the Chatterbox TTS service is healthy.
        
        Returns:
            True if healthy, False otherwise
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            response = requests.get(f"{base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def get_speakers(self) -> List[Dict[str, Any]]:
        """
        Get list of available speakers.
        
        Returns:
            List of speaker dictionaries
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            response = requests.get(f"{base_url}/voices", timeout=10)
            if response.status_code == 200:
                data = response.json()
                speakers = []
                for voice in data.get("voices", []):
                    speakers.append({
                        "id": voice,
                        "name": voice,
                        "language": "en"  # Default language
                    })
                return speakers
            return []
        except Exception as e:
            return []
    
    def generate_audio(self, text: str, speaker: Optional[str] = None, 
                      language: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """
        Generate audio from text using Chatterbox TTS.
        
        Args:
            text: The text to synthesize
            speaker: Optional speaker/voice to use
            language: Optional language code
            **kwargs: Provider-specific parameters
            
        Returns:
            Dict with 'success', 'audio' (base64), 'sample_rate', 'format' keys
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            
            # Build request payload
            payload = {"text": text}
            if language:
                payload["language"] = language
            if speaker:
                payload["speaker"] = speaker
            
            # Add any additional parameters
            payload.update(kwargs)
            
            response = requests.post(f"{base_url}/tts", json=payload, timeout=60)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    audio_b64 = data.get("audio", "")
                    sample_rate = data.get("sample_rate", 24000)
                    
                    return {
                        "success": True,
                        "audio": audio_b64,
                        "sample_rate": sample_rate,
                        "format": "audio/wav"
                    }
            
            return {"success": False, "error": "TTS generation failed"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def voice_clone(self, voice_id: str, audio_data: bytes, 
                   ref_text: Optional[str] = None) -> Dict[str, Any]:
        """
        Create a voice clone from audio data.
        
        Args:
            voice_id: Unique identifier for the voice clone
            audio_data: Reference audio data
            ref_text: Optional reference text for the voice
            
        Returns:
            Dict with 'success' status and optional 'message'
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            
            # Create multipart form data
            files = {
                'file': (f'{voice_id}.wav', audio_data, 'audio/wav')
            }
            data = {
                'voice_id': voice_id
            }
            if ref_text:
                data['ref_text'] = ref_text
            
            response = requests.post(f"{base_url}/voice_clone", files=files, data=data, timeout=60)
            
            if response.status_code == 200:
                result = response.json()
                return {
                    "success": result.get("success", False),
                    "message": result.get("message", "")
                }
            
            return {"success": False, "message": "Voice clone failed"}
            
        except Exception as e:
            return {"success": False, "message": str(e)}
    
    def get_capabilities(self) -> List[AudioProviderCapability]:
        """Get list of capabilities supported by Chatterbox TTS."""
        return [
            AudioProviderCapability.STREAMING,
            AudioProviderCapability.VOICE_CLONING,
            AudioProviderCapability.MULTILINGUAL
        ]


class ParakeetSTT(BaseSTTProvider):
    """
    Parakeet STT Provider - wraps FasterWhisper/Parakeet STT service.
    
    Manages the Parakeet/FasterWhisper subprocess and communicates via HTTP to localhost:8000.
    Handles audio file formatting for transcription.
    """
    
    provider_name = "parakeet"
    
    def start(self) -> Dict[str, Any]:
        """
        Start the Parakeet STT subprocess.
        
        Returns:
            Dict with 'running' status and optional 'message'
        """
        if self.process and self.process.poll() is None:
            return {"running": True, "message": "Service already running"}
        
        try:
            # Start the Parakeet STT server
            script_path = Path(__file__).parent.parent.parent / "parakeet_stt_server.py"
            if not script_path.exists():
                return {"running": False, "message": f"Server script not found: {script_path}"}
            
            self.process = subprocess.Popen(
                ['python', str(script_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            
            # Start log capture
            self._start_log_thread()
            
            # Wait for service to be ready
            max_wait = 30
            for _ in range(max_wait):
                if self.health_check():
                    return {"running": True, "message": "Parakeet STT started successfully"}
                time.sleep(1)
            
            # If we get here, service didn't start properly
            self.stop()
            return {"running": False, "message": "Service failed to start within timeout"}
            
        except Exception as e:
            return {"running": False, "message": f"Failed to start: {str(e)}"}
    
    def health_check(self) -> bool:
        """
        Check if the Parakeet STT service is healthy.
        
        Returns:
            True if healthy, False otherwise
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            response = requests.get(f"{base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def transcribe(self, audio_file_path: str, language: Optional[str] = None, 
                  **kwargs) -> Dict[str, Any]:
        """
        Transcribe audio file to text.
        
        Args:
            audio_file_path: Path to the audio file
            language: Optional language code
            **kwargs: Provider-specific parameters
            
        Returns:
            Dict with 'success', 'text', 'segments', 'duration' keys
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            
            # Open and send the audio file
            with open(audio_file_path, 'rb') as audio_file:
                files = {'file': (os.path.basename(audio_file_path), audio_file, 'audio/wav')}
                data = {}
                if language:
                    data['language'] = language
                data.update(kwargs)
                
                response = requests.post(f"{base_url}/transcribe", files=files, data=data, timeout=120)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    segments = data.get("segments", [])
                    text = ' '.join([s['text'] for s in segments])
                    
                    return {
                        "success": True,
                        "text": text,
                        "segments": segments,
                        "duration": data.get("duration")
                    }
            
            return {"success": False, "error": "Transcription failed"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def transcribe_raw(self, audio_data: bytes, sample_rate: int = 16000, 
                      language: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """
        Transcribe raw audio data to text.
        
        Args:
            audio_data: Raw audio bytes
            sample_rate: Audio sample rate
            language: Optional language code
            **kwargs: Provider-specific parameters
            
        Returns:
            Dict with 'success', 'text', 'segments', 'duration' keys
        """
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            
            # Create a temporary file-like object
            import io
            audio_file = io.BytesIO(audio_data)
            
            files = {'file': ('audio.wav', audio_file, 'audio/wav')}
            data = {}
            if language:
                data['language'] = language
            data.update(kwargs)
            
            response = requests.post(f"{base_url}/transcribe", files=files, data=data, timeout=120)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("success"):
                    segments = data.get("segments", [])
                    text = ' '.join([s['text'] for s in segments])
                    
                    return {
                        "success": True,
                        "text": text,
                        "segments": segments,
                        "duration": data.get("duration")
                    }
            
            return {"success": False, "error": "Transcription failed"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_capabilities(self) -> List[AudioProviderCapability]:
        """Get list of capabilities supported by Parakeet STT."""
        return [
            AudioProviderCapability.STREAMING,
            AudioProviderCapability.BATCH_PROCESSING,
            AudioProviderCapability.MULTILINGUAL
        ]