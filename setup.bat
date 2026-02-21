@echo off
REM ============================================
REM Omnix - Setup Script (Windows)
REM ============================================

echo =============================================
echo Omnix - Setup
echo =============================================
echo.
echo This will install all dependencies for:
echo   - Chatbot Web Server
echo   - Parakeet STT (Speech-to-Text)
echo   - Chatterbox TTS TURBO (Text-to-Speech)
echo.
pause

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.10 or higher from https://www.python.org/
    pause
    exit /b 1
)

REM Check Python version
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYVER=%%i
echo Python version: %PYVER%

echo.
echo [1/5] Installing PyTorch with CUDA 12.4 support...
echo This is CRITICAL - mismatched versions cause errors
echo.
pip install torch==2.5.1+cu124 torchvision==0.20.1+cu124 torchaudio==2.5.1+cu124 --index-url https://download.pytorch.org/whl/cu124
if errorlevel 1 (
    echo WARNING: Failed to install PyTorch with CUDA
    echo Trying CPU-only version...
    pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1
)

echo.
echo [2/5] Installing core dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install core dependencies
    pause
    exit /b 1
)

echo.
echo [3/5] Installing Chatterbox TTS TURBO...
pip install chatterbox-tts==0.1.6
if errorlevel 1 (
    echo WARNING: Failed to install Chatterbox TTS
    echo You can try: pip install chatterbox-tts
)

echo.
echo [4/5] Installing NeMo ASR for Parakeet STT...
pip install "nemo_toolkit[asr]"
if errorlevel 1 (
    echo WARNING: Failed to install NeMo ASR
    echo STT will not be available
    echo Try: pip install nemo_toolkit[asr]
)

echo.
echo [5/6] Pre-downloading Parakeet TDT 0.6B model...
echo This may take a few minutes...
echo Note: Model downloads to HuggingFace cache: %USERPROFILE%\.cache\huggingface\
python -c "from nemo.collections.asr.models import ASRModel; ASRModel.from_pretrained('nvidia/parakeet-tdt-0.6b-v2'); print('Parakeet model downloaded successfully!')" 2>nul
if errorlevel 1 (
    echo WARNING: Failed to pre-download Parakeet model
    echo It will be downloaded on first use instead
)

echo.
echo [6/7] Downloading default LLM (Qwen3-4B Q8_0)...
echo This provides an immediate working LLM for new installations
echo Model: qwen/Qwen3-4B-Instruct-2507-GGUF
echo Quantization: Q8_0 (~4GB)
echo.

REM Create models directory
if not exist "models\llm" mkdir "models\llm"

REM Download using huggingface-cli or curl
echo Downloading Qwen3-4B GGUF model...
python -c "from huggingface_hub import hf_hub_download; hf_hub_download(repo_id='qwen/Qwen3-4B-Instruct-2507-GGUF', filename='qwen3-4b-instruct-2507-q8_0.gguf', local_dir='models/llm', local_dir_use_symlinks=False)" 2>nul
if errorlevel 1 (
    echo Could not auto-download - will provide manual instructions below
) else (
    echo Qwen3-4B model downloaded to models/llm/
)

echo.
echo [7/7] Verifying installations...
echo.

REM Check PyTorch
python -c "import torch; print(f'PyTorch: {torch.__version__}')" 2>nul
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')" 2>nul

REM Check TTS
python -c "from chatterbox.tts_turbo import ChatterboxTurboTTS; print('Chatterbox TTS: OK')" 2>nul
if errorlevel 1 (
    echo Chatterbox TTS: FAILED - check torch/torchvision versions
)

REM Check STT
python -c "import nemo.collections.asr as nemo_asr; print('NeMo ASR: OK')" 2>nul
if errorlevel 1 (
    echo NeMo ASR: FAILED - check nemo_toolkit installation
)

echo.
echo =============================================
echo Setup Complete!
echo =============================================
echo.
echo IMPORTANT NOTES:
echo   - PyTorch must match torchvision version
echo   - Use parakeet_stt_server.py from root (not models folder)
echo   - transformers will be updated to 4.53.x by nemo_toolkit
echo.
echo To start services:
echo   start_all.bat             - Start all services
echo   start_parakeet_stt.bat    - Start STT only
echo   python chatterbox_tts_server.py - Start TTS only
echo.
pause