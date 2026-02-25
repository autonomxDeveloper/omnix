@echo off
echo ================================================
echo LM Studio Chatbot - Full Launcher
echo ================================================
echo.
echo This will start:
echo   1. Parakeet STT Server (port 8000) - Voice recognition
echo   2. Chatterbox TTS TURBO (port 8020) - Fast English voice synthesis
echo   3. Chatbot Web Server (port 5000) - Main application
echo.
echo Note: Make sure LM Studio is running with a model loaded.
echo       Or use Cerebras/OpenRouter API in settings.
echo.
echo Starting services...
echo.

cd /d "%~dp0"

:: Install dependencies
echo [Setup] Installing Python dependencies...
pip install -q fastapi uvicorn websockets aiohttp pydub numpy soundfile 2>nul

:: Set PARAKEET_FORCE_CPU=true if you want STT to use CPU (e.g., if GPU memory is limited)
:: Default is GPU mode - both LLM and STT share the GPU
if not defined PARAKEET_FORCE_CPU (
    set PARAKEET_FORCE_CPU=false
)

:: Start Parakeet STT Server in background
echo [1/3] Starting Parakeet STT Server on port 8000...
if exist "%~dp0parakeet_stt_server.py" (
    start "Parakeet STT" cmd /k "cd /d "%~dp0" && set PARAKEET_FORCE_CPU=%PARAKEET_FORCE_CPU% && python parakeet_stt_server.py"
) else (
    echo WARNING: parakeet_stt_server.py not found - STT will not be available
    echo Run setup to install nemo_toolkit[asr].
)


:: Wait a bit for STT to start
timeout /t 5 /nobreak >nul

:: Start Chatterbox TTS TURBO Server in background
:: GPU DSP Configuration:
::   USE_GPU_DSP=true        - All DSP (resample, DC offset, normalize) on GPU
::   STREAM_SAMPLE_RATE=48000 - Output sample rate for streaming (48kHz)
::   ENABLE_ENHANCEMENT=false - DeepFilterNet enhancement (only for offline WAV)
echo [2/3] Starting Chatterbox TTS TURBO on port 8020...
start "Chatterbox-TTS" cmd /k "set USE_GPU_DSP=true && set STREAM_SAMPLE_RATE=48000 && set ENABLE_ENHANCEMENT=false && python chatterbox_tts_server.py"


:: Wait a bit for TTS to start
timeout /t 5 /nobreak >nul

:: Start Chatbot
echo [3/3] Starting Chatbot on port 5000...
echo.
python app.py

echo.
echo Server closed. Press any key to exit...
pause >nul