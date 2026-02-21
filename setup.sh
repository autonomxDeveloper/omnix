#!/bin/bash

# ============================================
# Omnix - Setup Script (Linux/Mac)
# ============================================

echo "============================================="
echo "Omnix - Setup"
echo "============================================="
echo ""
echo "This will install all dependencies for:"
echo "  - Chatbot Web Server"
echo "  - Parakeet STT (Speech-to-Text)"
echo "  - Chatterbox TTS TURBO (Text-to-Speech)"
echo ""
read -p "Press Enter to continue..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "ERROR: Python is not installed or not in PATH"
        echo "Please install Python 3.10 or higher from https://www.python.org/"
        exit 1
    fi
    PYTHON_CMD="python"
else
    PYTHON_CMD="python3"
fi

# Check Python version
echo "Using Python: $($PYTHON_CMD --version)"

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo ""
echo "[1/5] Installing PyTorch with CUDA 12.4 support..."
echo "This is CRITICAL - mismatched versions cause errors"
echo ""
pip install torch==2.6.0+cu124 torchvision==0.21.0+cu124 torchaudio==2.6.0+cu124 --index-url https://download.pytorch.org/whl/cu124
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install PyTorch with CUDA"
    echo "Trying CPU-only version..."
    pip install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0
fi

echo ""
echo "[2/5] Installing core dependencies..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install core dependencies"
    exit 1
fi

echo ""
echo "[3/5] Installing Chatterbox TTS TURBO..."
pip install chatterbox-tts==0.1.6
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install Chatterbox TTS"
    echo "You can try: pip install chatterbox-tts"
fi

echo ""
echo "[4/5] Installing NeMo ASR for Parakeet STT..."
pip install "nemo_toolkit[asr]"
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install NeMo ASR"
    echo "STT will not be available"
    echo "Try: pip install nemo_toolkit[asr]"
fi

echo ""
echo "[5/6] Pre-downloading Parakeet TDT 0.6B model..."
echo "This may take a few minutes..."
echo "Note: Model downloads to HuggingFace cache: ~/.cache/huggingface/"
$PYTHON_CMD -c "from nemo.collections.asr.models import ASRModel; ASRModel.from_pretrained('nvidia/parakeet-tdt-0.6b-v2'); print('Parakeet model downloaded successfully!')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to pre-download Parakeet model"
    echo "It will be downloaded on first use instead"
fi

echo ""
echo "[6/6] Verifying installations..."
echo ""

# Check PyTorch
$PYTHON_CMD -c "import torch; print(f'PyTorch: {torch.__version__}')" 2>/dev/null
$PYTHON_CMD -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')" 2>/dev/null

# Check TTS
$PYTHON_CMD -c "from chatterbox.tts_turbo import ChatterboxTurboTTS; print('Chatterbox TTS: OK')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "Chatterbox TTS: FAILED - check torch/torchvision versions"
fi

# Check STT
$PYTHON_CMD -c "import nemo.collections.asr as nemo_asr; print('NeMo ASR: OK')" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "NeMo ASR: FAILED - check nemo_toolkit installation"
fi

echo ""
echo "============================================="
echo "Setup Complete!"
echo "============================================="
echo ""
echo "IMPORTANT NOTES:"
echo "  - PyTorch must match torchvision version"
echo "  - Use parakeet_stt_server.py from root (not models folder)"
echo "  - transformers will be updated to 4.53.x by nemo_toolkit"
echo ""
echo "To start services:"
echo "  ./start_all.sh             - Start all services"
echo "  ./start_parakeet_stt.sh    - Start STT only"
echo "  python chatterbox_tts_server.py - Start TTS only"
echo ""