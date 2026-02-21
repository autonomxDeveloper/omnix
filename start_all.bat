@echo off
echo ================================================
echo LM Studio Chatbot - Full Launcher
echo ================================================
echo.
echo This will start:
echo   1. Parakeet STT Server (port 8000) - Voice recognition
echo   2. Chatterbox TTS TURBO (port 8020) - Fast English voice synthesis
echo   3. Realtime WebSocket Server (port 8001) - Streaming voice chat
echo   4. Chatbot Web Server (port 5000) - Main application
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

:: Start Parakeet STT Server in background
echo [1/4] Starting Parakeet STT Server on port 8000...
if exist "%~dp0parakeet_stt_server.py" (
    start "Parakeet STT" cmd /k "cd /d "%~dp0" && python parakeet_stt_server.py"
) else (
    echo WARNING: parakeet_stt_server.py not found - STT will not be available
    echo Run setup to install nemo_toolkit[asr].
)


:: Wait a bit for STT to start
timeout /t 5 /nobreak >nul

:: Start Chatterbox TTS TURBO Server in background
echo [2/4] Starting Chatterbox TTS TURBO on port 8020...
start "Chatterbox-TTS" cmd /k "python chatterbox_tts_server.py"


:: Wait a bit for TTS to start
timeout /t 5 /nobreak >nul

:: Start Realtime WebSocket Server in background
echo [3/4] Starting Realtime Server on port 8001...
start "Realtime WS" cmd /k "python realtime_server.py"


:: Wait a bit for realtime server to start
timeout /t 3 /nobreak >nul

:: Start Chatbot
echo [4/4] Starting Chatbot on port 5000...
echo.
python app.py

echo.
echo Server closed. Press any key to exit...
pause >nul