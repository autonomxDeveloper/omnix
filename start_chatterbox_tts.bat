@echo off
echo Starting Chatterbox TTS TURBO Server...
echo.
echo Chatterbox TTS TURBO Features:
echo   - Ultra-fast English TTS (~200ms latency)
echo   - Optimized for real-time conversation
echo   - Voice cloning from reference audio
echo   - Streaming audio support via WebSocket
echo   - Natural prosody and emotion
echo.
echo Port: 8020
echo.

cd /d %~dp0

REM Check if chatterbox-tts is installed
python -c "import chatterbox" 2>nul
if errorlevel 1 (
    echo Installing chatterbox-tts...
    pip install chatterbox-tts
    echo.
)

echo Starting server...
python chatterbox_tts_server.py

pause