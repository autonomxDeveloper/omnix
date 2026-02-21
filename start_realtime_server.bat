@echo off
REM Startup script for Realtime WebSocket Server

echo ============================================
echo Starting Realtime WebSocket Server...
echo ============================================
echo.
echo This server provides:
echo   - /ws/chat   - Streaming chat messages
echo   - /ws/tts    - Streaming TTS audio
echo   - /ws/voice  - Full voice pipeline
echo.
echo Make sure these are running first:
echo   - XTTS server on port 8020
echo   - Parakeet STT on port 8000
echo   - LLM (Cerebras/LM Studio)
echo.

REM Set environment variables (customize as needed)
set LLM_PROVIDER=cerebras
set LLM_API_KEY=your_api_key_here
set TTS_BASE_URL=http://localhost:8020
set STT_BASE_URL=http://localhost:8000
set PORT=8001

REM Install dependencies if needed
pip install -q fastapi uvicorn websockets aiohttp

REM Start the server
python realtime_server.py

pause
