@echo off
echo ================================================
echo LM Studio Chatbot - Full Launcher
echo ================================================
echo.
echo This will start:
echo   1. Parakeet STT Server (port 8000) - Voice recognition
echo   2. FasterQwen3TTS Model (in-app) - Real-time multilingual TTS with voice cloning
echo   3. Chatbot Web Server (port 5000) - Main application
echo.
echo Note: Make sure LM Studio is running with a model loaded.
echo       Or use Cerebras/OpenRouter API in settings.
echo.
echo Starting services...
echo.

cd /d "%~dp0"

:: Check if virtual environment exists and activate it
if exist "venv" (
    echo [Setup] Activating virtual environment...
    call venv\Scripts\activate.bat
) else (
    echo WARNING: Virtual environment not found. You may need to run setup.bat first.
    echo Creating virtual environment now...
    python -m venv venv
    call venv\Scripts\activate.bat
    echo [Setup] Installing faster-qwen3-tts in virtual environment...
    pip install faster-qwen3-tts>=0.2.4
    echo [Setup] Virtual environment created and faster-qwen3-tts installed.
)

:: Check if PyTorch is already installed
echo [Setup] Checking PyTorch installation...
python -c "import torch; print('PyTorch already installed:', torch.__version__)" >nul 2>&1
if errorlevel 1 (
    echo [Setup] PyTorch not found, installing CUDA-enabled PyTorch for RTX 4090 compatibility...
    pip install torch==2.5.1+cu124 torchvision==0.20.1+cu124 torchaudio==2.5.1+cu124 --index-url https://download.pytorch.org/whl/cu124
) else (
    echo [Setup] PyTorch already installed, skipping download.
)

:: Check if faster-qwen3-tts is already installed
echo [Setup] Checking faster-qwen3-tts installation...
python -c "import faster_qwen3_tts; print('faster-qwen3-tts already installed:', faster_qwen3_tts.__version__)" >nul 2>&1
if errorlevel 1 (
    echo [Setup] faster-qwen3-tts not found, installing...
    pip install faster-qwen3-tts>=0.2.4
) else (
    echo [Setup] faster-qwen3-tts already installed, skipping download.
)

:: Install other dependencies
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

:: Start FasterQwen3TTS Model Setup
:: Note: FasterQwen3TTS loads the model directly in the application,
:: so no separate server process is needed. The model will be loaded
:: automatically when the chatbot starts and TTS is first used.
echo [2/3] Starting FasterQwen3TTS model...
echo    Model: Qwen/Qwen3-TTS-12Hz-0.6B-Base (configurable in settings)
echo    Device: CUDA (GPU) or CPU fallback
echo    Features: 6-10x speedup with CUDA graphs, voice cloning, multilingual

:: Start FasterQwen3TTS server in background
if exist "%~dp0models\tts\faster-qwen3-tts-streaming-server.py" (
    start "FasterQwen3TTS" cmd /k "cd /d "%~dp0" && python models\tts\faster-qwen3-tts-streaming-server.py"
) else (
    echo WARNING: faster-qwen3-tts-streaming-server.py not found - TTS will not be available
    echo Run setup_faster_qwen3_tts.py to install the model.
)

:: Wait a bit for TTS to start
timeout /t 5 /nobreak >nul

:: Start Chatbot
echo [3/3] Starting Chatbot on port 5000...
echo.
pushd "%~dp0"
python app.py
popd

echo.
echo Server closed. Press any key to exit...
pause >nul