@echo off
REM ============================================
REM LM Studio Chatbot - Setup Script
REM ============================================

echo =============================================
echo LM Studio Chatbot - Setup
echo =============================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.8 or higher from https://www.python.org/
    pause
    exit /b 1
)

echo [1/4] Installing Chatbot dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install chatbot dependencies
    pause
    exit /b 1
)

echo.
echo [2/4] Installing Parakeet STT dependencies...
if exist "parakeet-tdt-0.6b-v2" (
    cd parakeet-tdt-0.6b-v2
    pip install -r requirements.txt
    cd ..
    if errorlevel 1 (
        echo WARNING: Failed to install some Parakeet dependencies
        echo This may be okay if you already have them installed
    )
) else (
    echo WARNING: parakeet-tdt-0.6b-v2 directory not found
    echo STT will not be available. You can clone Parakeet from:
    echo https://github.com/NVIDIA/NeMo
)

echo.
echo [3/4] Installing Chatterbox TTS TURBO...
REM Install from local chatterbox directory
if exist "chatterbox" (
    pip install -e ./chatterbox
    if errorlevel 1 (
        echo WARNING: Failed to install local Chatterbox TTS
        echo Trying from PyPI...
        pip install chatterbox-tts
    ) else (
        echo Chatterbox TTS TURBO installed successfully from local directory!
    )
) else (
    pip install chatterbox-tts
    if errorlevel 1 (
        echo WARNING: Failed to install Chatterbox TTS
        echo You can try: pip install chatterbox-tts torch torchaudio
    ) else (
        echo Chatterbox TTS TURBO installed successfully!
    )
)

echo.
echo [4/4] Installing additional dependencies for voice cloning...
pip install pydub scipy
if errorlevel 1 (
    echo WARNING: Failed to install pydub/scipy - voice cloning may not work
)

echo.
echo =============================================
echo Setup Complete!
echo =============================================
echo.
echo To start services:
echo   start_chatbot.bat         - Start chatbot only
echo   start_parakeet_stt.bat    - Start Parakeet STT only
echo   start_chatterbox_tts.bat  - Start Chatterbox TTS TURBO
echo   start_all.bat             - Start all services
echo.
pause