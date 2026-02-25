@echo off
echo Starting OpenAI Compatible API Server...
echo =========================================

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Python is not installed or not in PATH. Please install Python first.
    pause
    exit /b 1
)

REM Check if virtual environment exists
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate

REM Install requirements if needed
echo Installing/updating requirements...
pip install -r requirements.txt

REM Start the OpenAI API server
echo Starting OpenAI Compatible API Server on port 8001...
echo Access the API at: http://localhost:8001
echo API endpoints:
echo   - /v1/models (list models)
echo   - /v1/audio/voices (list voices)
echo   - /v1/audio/speech (generate speech)
echo   - /v1/chat/completions (chat completions)
echo   - /health (health check)
echo.
echo Press Ctrl+C to stop the server
echo =========================================

python openai_api.py

pause