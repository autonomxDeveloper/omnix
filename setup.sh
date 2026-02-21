#!/bin/bash

# ============================================
# Omnix - Setup Script
# ============================================

echo "============================================="
echo "Omnix - Setup"
echo "============================================="
echo ""

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    if ! command -v python &> /dev/null; then
        echo "ERROR: Python is not installed or not in PATH"
        echo "Please install Python 3.8 or higher from https://www.python.org/"
        exit 1
    fi
    PYTHON_CMD="python"
else
    PYTHON_CMD="python3"
fi

# Check Python version
echo "Using Python: $($PYTHON_CMD --version)"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "[1/4] Installing Chatbot dependencies..."
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install chatbot dependencies"
    exit 1
fi

echo ""
echo "[2/4] Installing Parakeet STT dependencies..."
cd "$SCRIPT_DIR/parakeet-tdt-0.6b-v2"
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt
    if [ $? -ne 0 ]; then
        echo "WARNING: Failed to install some Parakeet dependencies"
        echo "This may be okay if you already have them installed"
    fi
else
    echo "WARNING: parakeet-tdt-0.6b-v2/requirements.txt not found"
fi
cd "$SCRIPT_DIR"

echo ""
echo "[3/4] Installing Chatterbox TTS TURBO..."
pip install chatterbox-tts
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install Chatterbox TTS"
    echo "You can try: pip install chatterbox-tts torch torchaudio"
else
    echo "Chatterbox TTS TURBO installed successfully!"
fi

echo ""
echo "[4/4] Installing additional dependencies for voice cloning..."
pip install pydub scipy
if [ $? -ne 0 ]; then
    echo "WARNING: Failed to install pydub/scipy - voice cloning may not work"
fi

echo ""
echo "============================================="
echo "Setup Complete!"
echo "============================================="
echo ""
echo "To start services:"
echo "  ./start_chatbot.sh         - Start chatbot only"
echo "  ./start_parakeet_stt.sh    - Start Parakeet STT only"
echo "  ./start_chatterbox_tts.sh  - Start Chatterbox TTS TURBO"
echo "  ./start_all.sh             - Start all services"
echo ""