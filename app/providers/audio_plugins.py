
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
        """Start the CosyVoice TTS subprocess."""
        if self.process and self.process.poll() is None:
            return {"running": True, "message": "Service already running"}
        
        try:
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
            
            self._start_log_thread()
            
            max_wait = 30
            for _ in range(max_wait):
                if self.health_check():
                    return {"running": True, "message": "Chatterbox TTS started successfully"}
                time.sleep(1)
            
            self.stop()
            return {"running": False, "message": "Service failed to start within timeout"}
            
        except Exception as e:
            return {"running": False, "message": f"Failed to start: {str(e)}"}
    
    def health_check(self) -> bool:
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            response = requests.get(f"{base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def get_speakers(self) -> List[Dict[str, Any]]:
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
                        "language": "en"
                    })
                return speakers
            return []
        except Exception as e:
            return []
    
    def generate_audio(self, text: str, speaker: Optional[str] = None, 
                      language: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """Generate audio from text using Chatterbox TTS."""
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            
            payload = {"text": text}
            if language:
                payload["language"] = language
            
            if speaker:
                # FIX: Send as BOTH speaker and voice_clone_id to ensure server picks it up
                # The server likely uses 'voice_clone_id' for custom/specific voice selection
                payload["speaker"] = speaker
                payload["voice_clone_id"] = speaker
                print(f"[CHATTERBOX-PLUGIN] Requesting speaker: '{speaker}' (sent as voice_clone_id)")
            else:
                print(f"[CHATTERBOX-PLUGIN] No speaker provided, using default.")
            
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
            print(f"[CHATTERBOX-PLUGIN] Error: {e}")
            return {"success": False, "error": str(e)}
    
    def voice_clone(self, voice_id: str, audio_data: bytes, 
                   ref_text: Optional[str] = None) -> Dict[str, Any]:
        try:
            base_url = self.config.get("base_url", "http://localhost:8020")
            
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
        return [
            AudioProviderCapability.STREAMING,
            AudioProviderCapability.VOICE_CLONING,
            AudioProviderCapability.MULTILINGUAL
        ]


class ParakeetSTT(BaseSTTProvider):
    """Parakeet STT Provider - wraps FasterWhisper/Parakeet STT service."""
    
    provider_name = "parakeet"
    
    def start(self) -> Dict[str, Any]:
        if self.process and self.process.poll() is None:
            return {"running": True, "message": "Service already running"}
        
        try:
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
            
            self._start_log_thread()
            
            max_wait = 30
            for _ in range(max_wait):
                if self.health_check():
                    return {"running": True, "message": "Parakeet STT started successfully"}
                time.sleep(1)
            
            self.stop()
            return {"running": False, "message": "Service failed to start within timeout"}
            
        except Exception as e:
            return {"running": False, "message": f"Failed to start: {str(e)}"}
    
    def health_check(self) -> bool:
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            response = requests.get(f"{base_url}/health", timeout=5)
            return response.status_code == 200
        except:
            return False
    
    def transcribe(self, audio_file_path: str, language: Optional[str] = None, 
                  **kwargs) -> Dict[str, Any]:
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            
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
        try:
            base_url = self.config.get("base_url", "http://localhost:8000")
            
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
        return [
            AudioProviderCapability.STREAMING,
            AudioProviderCapability.BATCH_PROCESSING,
            AudioProviderCapability.MULTILINGUAL
        ]